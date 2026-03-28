#include "claudebridge.h"
#include <QDir>
#include <QFile>
#include <QFileDialog>
#include <QFileInfo>
#include <QJsonArray>
#include <QJsonDocument>
#include <QJsonObject>

ClaudeBridge::ClaudeBridge(QObject *parent)
    : QObject(parent)
    , m_claude(new ClaudeProcess(this))
    , m_cwd(QDir::homePath())
{
    connect(m_claude, &ClaudeProcess::sessionInitialized, this, [this](const QString &id) {
        m_sessionId = id;
        emit sessionReady(id);
    });
    connect(m_claude, &ClaudeProcess::textReady,     this, &ClaudeBridge::textReady);
    connect(m_claude, &ClaudeProcess::toolUseStarted,this, &ClaudeBridge::toolUse);
    connect(m_claude, &ClaudeProcess::turnFinished,  this, &ClaudeBridge::turnComplete);
    connect(m_claude, &ClaudeProcess::errorOccurred, this, &ClaudeBridge::errorOccurred);
}

void ClaudeBridge::sendMessage(const QString &text) {
    if (text.trimmed().isEmpty()) return;
    m_claude->send(text.trimmed(), m_cwd, m_sessionId, m_model, m_yolo);
}

void ClaudeBridge::setModel(const QString &model) {
    if (m_model == model) return;
    m_model = model;
    emit modelChanged(model);
}

void ClaudeBridge::setYolo(bool enabled) {
    if (m_yolo == enabled) return;
    m_yolo = enabled;
    emit yoloChanged(enabled);
}

void ClaudeBridge::abort() {
    m_claude->abort();
}

void ClaudeBridge::setCwd(const QString &path) {
    if (m_cwd == path) return;
    m_cwd = path;
    m_sessionId.clear(); // new directory = fresh session
    emit cwdChanged(path);
}

void ClaudeBridge::pickFolder() {
    const QString dir = QFileDialog::getExistingDirectory(
        nullptr,
        "Select Working Directory",
        m_cwd,
        QFileDialog::ShowDirsOnly | QFileDialog::DontResolveSymlinks
    );
    if (!dir.isEmpty())
        setCwd(dir);
}

// Returns the ~/.claude/projects/ subdirectory for a given working directory.
// Claude encodes the path by replacing every '/' with '-'.
static QString claudeProjectDir(const QString &cwd) {
    QString encoded = cwd;
    encoded.replace('/', '-');
    return QDir::homePath() + "/.claude/projects/" + encoded;
}

void ClaudeBridge::requestSessions() {
    QJsonArray arr;
    QDir dir(claudeProjectDir(m_cwd));
    if (dir.exists()) {
        const QStringList files = dir.entryList({"*.jsonl"}, QDir::Files, QDir::Time);
        for (const QString &filename : files) {
            const QString sessionId = filename.left(filename.length() - 6);

            QFile f(dir.filePath(filename));
            if (!f.open(QIODevice::ReadOnly | QIODevice::Text)) continue;

            QString preview;
            QString timestamp;

            while (!f.atEnd()) {
                const QByteArray line = f.readLine().trimmed();
                if (line.isEmpty()) continue;
                const QJsonObject obj = QJsonDocument::fromJson(line).object();
                if (obj["type"].toString() != "user") continue;

                timestamp = obj["timestamp"].toString();
                const QJsonValue content = obj["message"].toObject()["content"];
                if (content.isString()) {
                    preview = content.toString().left(120);
                } else if (content.isArray()) {
                    for (const QJsonValue &v : content.toArray()) {
                        if (v.toObject()["type"].toString() == "text") {
                            preview = v.toObject()["text"].toString().left(120);
                            break;
                        }
                    }
                }
                break;
            }

            if (preview.isEmpty()) continue;

            QJsonObject entry;
            entry["id"]        = sessionId;
            entry["preview"]   = preview;
            entry["timestamp"] = timestamp;
            arr.append(entry);
        }
    }
    emit sessionsListed(QString::fromUtf8(QJsonDocument(arr).toJson(QJsonDocument::Compact)));
}

void ClaudeBridge::loadSession(const QString &sessionId) {
    if (m_sessionId == sessionId) return;
    m_sessionId = sessionId;
    emit sessionReady(sessionId);

    // Read the JSONL and reconstruct conversation turns for display.
    // Each line is a single content block. We group them into user/assistant turns:
    //   - user turn:      type==user AND content is not a tool_result
    //   - assistant turn: accumulated text from consecutive type==assistant lines
    QJsonArray turns;
    QFile f(claudeProjectDir(m_cwd) + "/" + sessionId + ".jsonl");
    if (!f.open(QIODevice::ReadOnly | QIODevice::Text)) {
        emit sessionHistoryLoaded("[]");
        return;
    }

    QString pendingAssistantText;

    auto flushAssistant = [&]() {
        if (pendingAssistantText.isEmpty()) return;
        QJsonObject t;
        t["role"] = "assistant";
        t["text"] = pendingAssistantText.trimmed();
        turns.append(t);
        pendingAssistantText.clear();
    };

    while (!f.atEnd()) {
        const QByteArray raw = f.readLine().trimmed();
        if (raw.isEmpty()) continue;
        const QJsonObject obj = QJsonDocument::fromJson(raw).object();
        const QString type = obj["type"].toString();

        if (type == "user") {
            flushAssistant();
            const QJsonValue content = obj["message"].toObject()["content"];
            // Skip tool_result entries (internal tool feedback, not user messages)
            bool isToolResult = false;
            if (content.isArray()) {
                const QJsonArray arr = content.toArray();
                if (!arr.isEmpty() && arr[0].toObject()["type"].toString() == "tool_result")
                    isToolResult = true;
            }
            if (isToolResult) continue;

            QString text;
            if (content.isString()) {
                text = content.toString();
            } else if (content.isArray()) {
                for (const QJsonValue &v : content.toArray()) {
                    if (v.toObject()["type"].toString() == "text")
                        text += v.toObject()["text"].toString();
                }
            }
            if (text.trimmed().isEmpty()) continue;

            QJsonObject t;
            t["role"] = "user";
            t["text"] = text.trimmed();
            turns.append(t);

        } else if (type == "assistant") {
            const QJsonArray content = obj["message"].toObject()["content"].toArray();
            for (const QJsonValue &v : content) {
                const QJsonObject block = v.toObject();
                const QString btype = block["type"].toString();
                if (btype == "text")
                    pendingAssistantText += block["text"].toString();
                // skip thinking, tool_use
            }
        }
    }
    flushAssistant();

    emit sessionHistoryLoaded(
        QString::fromUtf8(QJsonDocument(turns).toJson(QJsonDocument::Compact)));
}

void ClaudeBridge::newSession() {
    if (m_sessionId.isEmpty()) return;
    m_sessionId.clear();
    emit sessionReady(QString());
}

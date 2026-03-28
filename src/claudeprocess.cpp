#include "claudeprocess.h"
#include <QJsonArray>
#include <QJsonDocument>
#include <QJsonObject>

ClaudeProcess::ClaudeProcess(QObject *parent) : QObject(parent) {}

ClaudeProcess::~ClaudeProcess() { killCurrent(); }

void ClaudeProcess::killCurrent() {
    if (!m_proc) return;
    m_proc->disconnect();
    m_proc->kill();
    m_proc->waitForFinished(1000);
    m_proc->deleteLater();
    m_proc = nullptr;
    m_buffer.clear();
}

void ClaudeProcess::send(const QString &prompt, const QString &cwd,
                         const QString &sessionId, const QString &model, bool yolo) {
    killCurrent();

    m_proc = new QProcess(this);
    m_proc->setWorkingDirectory(cwd);
    m_proc->setProcessChannelMode(QProcess::SeparateChannels);

    QStringList args{"--output-format", "stream-json", "--verbose", "--print", prompt};
    if (!sessionId.isEmpty())
        args << "--resume" << sessionId;
    if (!model.isEmpty())
        args << "--model" << model;
    if (yolo)
        args << "--dangerously-skip-permissions";

    connect(m_proc, &QProcess::readyReadStandardOutput, this, &ClaudeProcess::onReadyRead);
    connect(m_proc, &QProcess::errorOccurred,           this, &ClaudeProcess::onProcessError);
    connect(m_proc, QOverload<int, QProcess::ExitStatus>::of(&QProcess::finished),
            this, [this](int exitCode, QProcess::ExitStatus) {
        onReadyRead(); // flush remaining buffer
        if (exitCode != 0) {
            const QString err = QString::fromUtf8(m_proc->readAllStandardError()).trimmed();
            if (!err.isEmpty()) emit errorOccurred(err);
        }
        emit turnFinished();
    });

    m_proc->start("claude", args);
    if (!m_proc->waitForStarted(3000)) {
        emit errorOccurred("Failed to start 'claude'. Is it installed?\n  npm install -g @anthropic-ai/claude-code");
        m_proc->deleteLater();
        m_proc = nullptr;
    }
}

void ClaudeProcess::abort() {
    killCurrent();
    emit turnFinished();
}

void ClaudeProcess::onReadyRead() {
    if (!m_proc) return;
    m_buffer += m_proc->readAllStandardOutput();

    int newline;
    while ((newline = m_buffer.indexOf('\n')) != -1) {
        const QByteArray line = m_buffer.left(newline).trimmed();
        m_buffer = m_buffer.mid(newline + 1);
        if (!line.isEmpty())
            parseLine(line);
    }
}

void ClaudeProcess::parseLine(const QByteArray &line) {
    QJsonParseError parseErr;
    const QJsonDocument doc = QJsonDocument::fromJson(line, &parseErr);
    if (parseErr.error != QJsonParseError::NoError || !doc.isObject()) return;

    const QJsonObject obj  = doc.object();
    const QString     type = obj["type"].toString();

    if (type == "system" && obj["subtype"].toString() == "init") {
        emit sessionInitialized(obj["session_id"].toString());

    } else if (type == "assistant") {
        const QJsonArray content = obj["message"].toObject()["content"].toArray();
        for (const QJsonValue &val : content) {
            const QJsonObject block = val.toObject();
            const QString     btype = block["type"].toString();

            if (btype == "text") {
                emit textReady(block["text"].toString());
            } else if (btype == "tool_use") {
                const QString inputJson =
                    QJsonDocument(block["input"].toObject()).toJson(QJsonDocument::Compact);
                emit toolUseStarted(block["name"].toString(), inputJson);
            }
            // "thinking" blocks are intentionally skipped for this POC
        }

    } else if (type == "result") {
        if (obj["is_error"].toBool()) {
            emit errorOccurred(obj["result"].toString());
        } else {
            emit resultReceived(obj);
        }
    }
}

void ClaudeProcess::onProcessError(QProcess::ProcessError error) {
    if (error == QProcess::FailedToStart)
        emit errorOccurred("'claude' not found in PATH.\n  npm install -g @anthropic-ai/claude-code");
}

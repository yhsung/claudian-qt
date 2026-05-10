#include "claudebridge.h"
#include <QApplication>
#include <QBuffer>
#include <QClipboard>
#include <QMimeData>
#include <QDir>
#include <QFileDialog>
#include <QImage>
#include <QJsonArray>
#include <QJsonDocument>
#include <QJsonObject>

ClaudeBridge::ClaudeBridge(QObject *parent)
    : QObject(parent)
    , m_daemon(new BridgeDaemon(this))
    , m_attachmentStore(new AttachmentStore(this))
    , m_cwd(QDir::homePath())
{
    connect(m_daemon, &BridgeDaemon::sessionInitialized,   this, &ClaudeBridge::sessionReady);
    connect(m_daemon, &BridgeDaemon::textReady,            this, &ClaudeBridge::textReady);
    connect(m_daemon, &BridgeDaemon::toolUseStarted,       this, &ClaudeBridge::toolUse);
    connect(m_daemon, &BridgeDaemon::turnFinished,         this, &ClaudeBridge::turnComplete);
    connect(m_daemon, &BridgeDaemon::errorOccurred,        this, &ClaudeBridge::errorOccurred);
    connect(m_daemon, &BridgeDaemon::sessionsListed,       this, &ClaudeBridge::sessionsListed);
    connect(m_daemon, &BridgeDaemon::sessionHistoryLoaded, this, &ClaudeBridge::sessionHistoryLoaded);

    connect(m_daemon, &BridgeDaemon::resultReceived, this, [this](const QJsonObject &result) {
        if (result["is_error"].toBool()) return;
        int inputTokens  = 0;
        int outputTokens = 0;
        int contextWindow = 0;
        int numTurns = result["num_turns"].toInt(0);

        const QJsonObject modelUsage = result["modelUsage"].toObject();
        for (auto it = modelUsage.begin(); it != modelUsage.end(); ++it) {
            const QJsonObject m = it.value().toObject();
            inputTokens  += m["inputTokens"].toInt(0);
            outputTokens += m["outputTokens"].toInt(0);
            contextWindow = qMax(contextWindow, m["contextWindow"].toInt(0));
        }

        if (modelUsage.isEmpty()) {
            const QJsonObject usage = result["usage"].toObject();
            inputTokens  = usage["input_tokens"].toInt(0);
            outputTokens = usage["output_tokens"].toInt(0);
        }

        const QJsonObject payload{
            {"inputTokens",   inputTokens},
            {"outputTokens",  outputTokens},
            {"contextWindow", contextWindow},
            {"numTurns",      numTurns}
        };
        emit usageUpdated(
            QString::fromUtf8(QJsonDocument(payload).toJson(QJsonDocument::Compact))
        );
    });

    connect(m_daemon, &BridgeDaemon::daemonStarted, this, [this]() {
        m_daemon->sendCommand(QJsonObject{{"type", "set_cwd"},   {"cwd",   m_cwd}});
        if (!m_model.isEmpty())
            m_daemon->sendCommand(QJsonObject{{"type", "set_model"}, {"model", m_model}});
        if (m_yolo)
            m_daemon->sendCommand(QJsonObject{{"type", "set_yolo"},  {"yolo",  m_yolo}});
    });

    m_daemon->start();
}

void ClaudeBridge::sendMessage(const QString &text, const QString &attachmentsJson) {
    QJsonParseError err;
    const QJsonDocument doc = QJsonDocument::fromJson(attachmentsJson.toUtf8(), &err);
    if (err.error != QJsonParseError::NoError || !doc.isArray()) {
        emit errorOccurred("Invalid attachment payload.");
        return;
    }
    if (text.trimmed().isEmpty() && doc.array().isEmpty()) return;
    QJsonObject cmd{
        {"type", "send"},
        {"prompt", text.trimmed()},
        {"attachments", doc.array()}
    };
    if (!m_model.isEmpty()) cmd["model"] = m_model;
    if (m_yolo)             cmd["yolo"]  = m_yolo;
    m_daemon->sendCommand(cmd);
}

void ClaudeBridge::abort() {
    m_daemon->abort();
}

void ClaudeBridge::setCwd(const QString &path) {
    if (m_cwd == path) return;
    m_cwd = path;
    m_daemon->sendCommand(QJsonObject{{"type", "set_cwd"}, {"cwd", path}});
    emit cwdChanged(path);
}

void ClaudeBridge::setModel(const QString &model) {
    if (m_model == model) return;
    m_model = model;
    m_daemon->sendCommand(QJsonObject{{"type", "set_model"}, {"model", model}});
    emit modelChanged(model);
}

void ClaudeBridge::setYolo(bool enabled) {
    if (m_yolo == enabled) return;
    m_yolo = enabled;
    m_daemon->sendCommand(QJsonObject{{"type", "set_yolo"}, {"yolo", enabled}});
    emit yoloChanged(enabled);
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

void ClaudeBridge::pickImages() {
    const QStringList paths = QFileDialog::getOpenFileNames(
        qobject_cast<QWidget*>(parent()),
        "Select Images",
        m_cwd,
        "Images (*.png *.jpg *.jpeg *.gif *.webp)"
    );

    QJsonArray imported;
    for (const QString &path : paths) {
        const QString json = m_attachmentStore->importFile(path);
        if (!json.isEmpty()) imported.append(QJsonDocument::fromJson(json.toUtf8()).object());
    }
    emit imagesPicked(QString::fromUtf8(QJsonDocument(imported).toJson(QJsonDocument::Compact)));
}

void ClaudeBridge::importImageData(
    const QString &requestId,
    const QString &originalName,
    const QString &mimeType,
    const QString &base64Data
) {
    const QString json = m_attachmentStore->importBase64Image(originalName, mimeType, base64Data);
    if (json.isEmpty()) {
        emit errorOccurred("Failed to import image data.");
        return;
    }
    emit imageImported(requestId, json);
}

void ClaudeBridge::pasteImageFromClipboard() {
    const QMimeData *mime = QApplication::clipboard()->mimeData();
    if (!mime || !mime->hasImage()) return;

    QImage img = qvariant_cast<QImage>(mime->imageData());
    if (img.isNull()) return;

    QByteArray pngBytes;
    QBuffer buf(&pngBytes);
    buf.open(QIODevice::WriteOnly);
    if (!img.save(&buf, "PNG")) return;

    const QString json = m_attachmentStore->importBytes(pngBytes, "clipboard-image.png", "image/png");
    if (json.isEmpty()) return;

    QJsonArray arr;
    arr.append(QJsonDocument::fromJson(json.toUtf8()).object());
    emit imagesPicked(QString::fromUtf8(QJsonDocument(arr).toJson(QJsonDocument::Compact)));
}

void ClaudeBridge::requestSessions() {
    m_daemon->sendCommand(QJsonObject{{"type", "request_sessions"}});
}

void ClaudeBridge::loadSession(const QString &sessionId) {
    m_daemon->sendCommand(QJsonObject{{"type", "load_session"}, {"sessionId", sessionId}});
}

void ClaudeBridge::newSession() {
    m_daemon->sendCommand(QJsonObject{{"type", "new_session"}});
}

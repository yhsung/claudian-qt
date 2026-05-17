#include "claudebridge.h"
#include <QApplication>
#include <QBuffer>
#include <QClipboard>
#include <QFile>
#include <QMimeData>
#include <QDir>
#include <QFileDialog>
#include <QImage>
#include <QJsonArray>
#include <QJsonDocument>
#include <QJsonObject>
#include <QTextStream>

ClaudeBridge::ClaudeBridge(QObject *parent)
    : QObject(parent)
    , m_daemon(new BridgeDaemon(this))
    , m_attachmentStore(new AttachmentStore(this))
    , m_cwd(QDir::homePath())
{
    connect(m_daemon, &BridgeDaemon::sessionInitialized,   this, &ClaudeBridge::sessionReady);
    connect(m_daemon, &BridgeDaemon::textReady,            this, &ClaudeBridge::textReady);
    connect(m_daemon, &BridgeDaemon::toolUseStarted,       this, &ClaudeBridge::toolUse);
    connect(m_daemon, &BridgeDaemon::toolResultReceived,      this, &ClaudeBridge::toolResult);
    connect(m_daemon, &BridgeDaemon::thinkingChunkReceived,   this, &ClaudeBridge::thinkingChunk);
    connect(m_daemon, &BridgeDaemon::subAgentMessageReceived, this, &ClaudeBridge::subAgentMessage);
    connect(m_daemon, &BridgeDaemon::permissionRequested,     this, &ClaudeBridge::permissionRequested);
    connect(m_daemon, &BridgeDaemon::askUserQuestion,         this, &ClaudeBridge::askUserQuestion);
    connect(m_daemon, &BridgeDaemon::turnFinished,         this, &ClaudeBridge::turnComplete);
    connect(m_daemon, &BridgeDaemon::errorOccurred,        this, &ClaudeBridge::errorOccurred);
    connect(m_daemon, &BridgeDaemon::sessionsListed,       this, &ClaudeBridge::sessionsListed);
    connect(m_daemon, &BridgeDaemon::sessionHistoryLoaded, this, &ClaudeBridge::sessionHistoryLoaded);
    connect(m_daemon, &BridgeDaemon::exportResult,         this, &ClaudeBridge::exportResult);
    connect(m_daemon, &BridgeDaemon::toolProgress,         this, &ClaudeBridge::toolProgress);
    connect(m_daemon, &BridgeDaemon::rateLimit,            this, &ClaudeBridge::rateLimit);
    connect(m_daemon, &BridgeDaemon::fastModeStateChanged, this, &ClaudeBridge::fastModeStateChanged);
    connect(m_daemon, &BridgeDaemon::promptSuggestion,     this, &ClaudeBridge::promptSuggestion);
    connect(m_daemon, &BridgeDaemon::compactBoundary,      this, &ClaudeBridge::compactBoundary);
    connect(m_daemon, &BridgeDaemon::modelsListed,         this, &ClaudeBridge::modelsListed);
    connect(m_daemon, &BridgeDaemon::sessionForked,        this, &ClaudeBridge::sessionForked);
    connect(m_daemon, &BridgeDaemon::agentNotification,   this, &ClaudeBridge::agentNotification);
    connect(m_daemon, &BridgeDaemon::rewindResult,        this, &ClaudeBridge::rewindResult);
    connect(m_daemon, &BridgeDaemon::accountInfoReceived, this, &ClaudeBridge::accountInfoReceived);

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
            {"inputTokens",      inputTokens},
            {"outputTokens",     outputTokens},
            {"contextWindow",    contextWindow},
            {"numTurns",         numTurns},
            {"stopReason",       result["stop_reason"].toString()},
            {"subtype",          result["subtype"].toString()},
            {"cacheReadTokens",  result["cacheReadTokens"].toInt(0)},
            {"cacheCreatedTokens", result["cacheCreatedTokens"].toInt(0)}
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

void ClaudeBridge::deleteSession(const QString &sessionId) {
    m_daemon->sendCommand(QJsonObject{{"type", "delete_session"}, {"sessionId", sessionId}});
}

void ClaudeBridge::renameSession(const QString &sessionId, const QString &name) {
    m_daemon->sendCommand(QJsonObject{
        {"type",      "rename_session"},
        {"sessionId", sessionId},
        {"name",      name}
    });
}

void ClaudeBridge::exportSession(const QString &sessionId, const QString &preset, const QString &obsidianFolder, const QString &suggestedName) {
    m_daemon->sendCommand(QJsonObject{
        {"type",           "export_session"},
        {"sessionId",      sessionId},
        {"preset",         preset},
        {"obsidianFolder", obsidianFolder},
        {"suggestedName",  suggestedName}
    });
}

void ClaudeBridge::setPermissionMode(const QString &mode) {
    m_daemon->sendCommand(QJsonObject{{"type", "set_permission_mode"}, {"mode", mode}});
}

void ClaudeBridge::respondToPermission(const QString &requestId, bool allow, bool alwaysAllow) {
    m_daemon->sendCommand(QJsonObject{
        {"type",        "permission_response"},
        {"requestId",   requestId},
        {"allow",       allow},
        {"alwaysAllow", alwaysAllow}
    });
}

void ClaudeBridge::respondToAskUser(const QString &requestId, const QString &answersJson) {
    QJsonParseError err;
    const QJsonDocument doc = QJsonDocument::fromJson(answersJson.toUtf8(), &err);
    if (err.error != QJsonParseError::NoError || !doc.isObject()) {
        emit errorOccurred("Invalid answers payload.");
        return;
    }
    m_daemon->sendCommand(QJsonObject{
        {"type",      "ask_user_response"},
        {"requestId", requestId},
        {"answers",   doc.object()}
    });
}

void ClaudeBridge::writeTextFile(const QString &suggestedName, const QString &content) {
    const QString path = QFileDialog::getSaveFileName(
        nullptr,
        "Export Transcript",
        QDir::homePath() + "/" + suggestedName,
        "Markdown (*.md);;Plain Text (*.txt);;All Files (*)"
    );
    if (path.isEmpty()) {
        emit fileWritten(false, {});
        return;
    }
    QFile file(path);
    if (!file.open(QIODevice::WriteOnly | QIODevice::Text)) {
        emit fileWritten(false, path);
        return;
    }
    QTextStream out(&file);
    out << content;
    file.close();
    emit fileWritten(true, path);
}

void ClaudeBridge::copyToClipboard(const QString &text) {
    QClipboard *clipboard = QApplication::clipboard();
    clipboard->setText(text);
    emit clipboardCopyRequested(text);
}

void ClaudeBridge::requestModels() {
    m_daemon->sendCommand(QJsonObject{{"type", "request_models"}});
}

void ClaudeBridge::setThinking(const QString &thinkingType, int budgetTokens) {
    QJsonObject cmd{{"type", "set_thinking"}, {"thinkingType", thinkingType}};
    if (budgetTokens > 0) cmd["budgetTokens"] = budgetTokens;
    m_daemon->sendCommand(cmd);
}

void ClaudeBridge::setRunOptions(int maxTurns, double maxBudgetUsd,
                                  const QString &effort, const QString &systemPrompt) {
    QJsonObject cmd{{"type", "set_run_options"}};
    if (maxTurns > 0)            cmd["maxTurns"]     = maxTurns;
    if (maxBudgetUsd > 0.0)      cmd["maxBudgetUsd"] = maxBudgetUsd;
    if (!effort.isEmpty())       cmd["effort"]        = effort;
    cmd["systemPrompt"] = systemPrompt;
    m_daemon->sendCommand(cmd);
}

void ClaudeBridge::forkSession() {
    m_daemon->sendCommand(QJsonObject{{"type", "fork_session"}});
}

void ClaudeBridge::setToolControls(const QString &allowedJson, const QString &disallowedJson) {
    auto parseList = [](const QString &json) -> QJsonArray {
        QJsonParseError err;
        const QJsonDocument doc = QJsonDocument::fromJson(json.toUtf8(), &err);
        return (err.error == QJsonParseError::NoError && doc.isArray()) ? doc.array() : QJsonArray{};
    };
    m_daemon->sendCommand(QJsonObject{
        {"type",            "set_tool_controls"},
        {"allowedTools",    parseList(allowedJson)},
        {"disallowedTools", parseList(disallowedJson)},
    });
}

void ClaudeBridge::setMcpServers(const QString &serversJson) {
    QJsonParseError err;
    const QJsonDocument doc = QJsonDocument::fromJson(serversJson.toUtf8(), &err);
    if (err.error != QJsonParseError::NoError || !doc.isObject()) {
        emit errorOccurred("Invalid MCP servers JSON.");
        return;
    }
    m_daemon->sendCommand(QJsonObject{{"type", "set_mcp_servers"}, {"servers", doc.object()}});
}

void ClaudeBridge::setAgents(const QString &agentsJson) {
    QJsonParseError err;
    const QJsonDocument doc = QJsonDocument::fromJson(agentsJson.toUtf8(), &err);
    if (err.error != QJsonParseError::NoError || !doc.isObject()) {
        emit errorOccurred("Invalid agents JSON.");
        return;
    }
    m_daemon->sendCommand(QJsonObject{{"type", "set_agents"}, {"agents", doc.object()}});
}

void ClaudeBridge::rewindFiles(const QString &userMessageId, bool dryRun) {
    m_daemon->sendCommand(QJsonObject{
        {"type",          "rewind_files"},
        {"userMessageId", userMessageId},
        {"dryRun",        dryRun},
    });
}

void ClaudeBridge::requestAccountInfo() {
    m_daemon->sendCommand(QJsonObject{{"type", "request_account_info"}});
}

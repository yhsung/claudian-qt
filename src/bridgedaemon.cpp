#include "bridgedaemon.h"
#include <QCoreApplication>
#include <QDir>
#include <QFile>
#include <QFileInfo>
#include <QJsonDocument>
#include <QStandardPaths>
#include <QTimer>

static QString findNodeBinary() {
    const QString home = QDir::homePath();
    const QStringList extraDirs = {
        home + "/.nvm/current/bin",
        home + "/.volta/bin",
        home + "/.fnm/current/bin",
        "/opt/homebrew/bin",
        "/usr/local/bin",
        "/usr/bin",
    };
    for (const QString &dir : extraDirs) {
        const QString path = dir + "/node";
        if (QFile::exists(path))
            return path;
    }
    return QStandardPaths::findExecutable("node");
}

static QString findDaemonScript() {
    const QString appDir = QCoreApplication::applicationDirPath();

    // Windows production / any platform: bridge/ next to the executable
    const QString nextToExe = appDir + "/bridge/daemon.js";
    if (QFileInfo::exists(nextToExe))
        return QFileInfo(nextToExe).canonicalFilePath();

    // macOS app bundle: Contents/Resources/bridge/daemon.js
    const QString bundlePath = appDir + "/../Resources/bridge/daemon.js";
    if (QFileInfo(bundlePath).exists())
        return QFileInfo(bundlePath).canonicalFilePath();

    // macOS development: binary at build/ClaudianQt.app/Contents/MacOS/ (4 levels up)
    const QString macDevPath = appDir + "/../../../../bridge/dist/daemon.js";
    if (QFileInfo(macDevPath).exists())
        return QFileInfo(macDevPath).canonicalFilePath();

    // Windows development: binary at build/Release/ (2 levels up to project root)
    const QString winDevPath = appDir + "/../../bridge/dist/daemon.js";
    if (QFileInfo(winDevPath).exists())
        return QFileInfo(winDevPath).canonicalFilePath();

    return {};
}

BridgeDaemon::BridgeDaemon(QObject *parent) : QObject(parent) {}

BridgeDaemon::~BridgeDaemon() {
    if (!m_proc) return;
    m_proc->disconnect();
    m_proc->kill();
    m_proc->waitForFinished(1000);
}

void BridgeDaemon::start() {
    startDaemon();
}

void BridgeDaemon::startDaemon() {
    if (m_proc) {
        m_proc->disconnect();
        m_proc->kill();
        m_proc->waitForFinished(500);
        m_proc->deleteLater();
        m_proc = nullptr;
    }
    m_buffer.clear();

    const QString nodePath   = findNodeBinary();
    const QString daemonPath = findDaemonScript();

    if (nodePath.isEmpty()) {
        emit errorOccurred("'node' not found.\n  Install Node.js 18+.");
        return;
    }
    if (daemonPath.isEmpty()) {
        emit errorOccurred("Daemon script not found.\n  Run: cd bridge && npm install && npm run build");
        return;
    }

    m_proc = new QProcess(this);
    m_proc->setProcessChannelMode(QProcess::SeparateChannels);

    connect(m_proc, &QProcess::readyReadStandardOutput, this, &BridgeDaemon::onReadyRead);
    connect(m_proc, &QProcess::errorOccurred,           this, &BridgeDaemon::onProcessError);
    connect(m_proc, QOverload<int, QProcess::ExitStatus>::of(&QProcess::finished),
            this,   &BridgeDaemon::onDaemonFinished);

    m_proc->start(nodePath, {daemonPath});
    if (!m_proc->waitForStarted(3000)) {
        emit errorOccurred("Failed to start daemon: " + daemonPath);
        m_proc->disconnect();
        m_proc->deleteLater();
        m_proc = nullptr;
        return;
    }
    // Daemon started successfully — notify so callers can resync state
    m_restartCount = 0;
    emit daemonStarted();
}

void BridgeDaemon::sendCommand(const QJsonObject &cmd) {
    if (!m_proc || m_proc->state() != QProcess::Running) {
        emit errorOccurred("Bridge daemon is not running.");
        return;
    }
    m_proc->write(QJsonDocument(cmd).toJson(QJsonDocument::Compact) + "\n");
}

void BridgeDaemon::abort() {
    sendCommand(QJsonObject{{"type", "abort"}});
}

void BridgeDaemon::onReadyRead() {
    if (!m_proc) return;
    m_buffer += m_proc->readAllStandardOutput();

    int newline;
    while ((newline = m_buffer.indexOf('\n')) != -1) {
        const QByteArray line = m_buffer.left(newline).trimmed();
        m_buffer = m_buffer.mid(newline + 1);
        if (line.isEmpty()) continue;
        QJsonParseError err;
        const QJsonDocument doc = QJsonDocument::fromJson(line, &err);
        if (err.error != QJsonParseError::NoError || !doc.isObject()) continue;
        handleEvent(doc.object());
    }
}

void BridgeDaemon::handleEvent(const QJsonObject &event) {
    const QString type = event["type"].toString();

    if      (type == "text_ready")              emit textReady(event["text"].toString());
    else if (type == "tool_use")                emit toolUseStarted(event["id"].toString(), event["name"].toString(), event["input"].toString());
    else if (type == "tool_result")             emit toolResultReceived(event["toolUseId"].toString(), event["content"].toString(), event["isError"].toBool());
    else if (type == "thinking_chunk")          emit thinkingChunkReceived(event["text"].toString());
    else if (type == "sub_agent_message")       emit subAgentMessageReceived(event["parentToolUseId"].toString(), event["text"].toString());
    else if (type == "permission_request")      emit permissionRequested(
                                                    event["requestId"].toString(),
                                                    event["toolName"].toString(),
                                                    event["input"].toString(),
                                                    event["title"].toString(),
                                                    event["description"].toString(),
                                                    event["displayName"].toString(),
                                                    event["decisionReason"].toString(),
                                                    event["blockedPath"].toString());
    else if (type == "turn_complete")           emit turnFinished();
    else if (type == "session_ready")           emit sessionInitialized(event["sessionId"].toString());
    else if (type == "error")                   emit errorOccurred(event["msg"].toString());
    else if (type == "sessions_listed")         emit sessionsListed(event["json"].toString());
    else if (type == "session_history_loaded")  emit sessionHistoryLoaded(event["json"].toString());
    else if (type == "session_renamed")         { /* sessions_listed is also emitted after rename — sidebar updates via sessionsListed signal */ }
    else if (type == "result")                  emit resultReceived(event["data"].toObject());
}

void BridgeDaemon::onDaemonFinished(int exitCode, QProcess::ExitStatus) {
    const QString err = m_proc ? QString::fromUtf8(m_proc->readAllStandardError()).trimmed() : QString();
    if (m_proc) { m_proc->deleteLater(); m_proc = nullptr; }

    if (exitCode != 0 && !err.isEmpty())
        emit errorOccurred("Bridge daemon exited: " + err);

    // Restart with exponential backoff, max 3 attempts
    if (m_restartCount < 3) {
        const int delayMs = (1 << m_restartCount) * 500;
        ++m_restartCount;
        QTimer::singleShot(delayMs, this, &BridgeDaemon::startDaemon);
    } else {
        emit errorOccurred("Bridge daemon failed to restart after 3 attempts.");
    }
}

void BridgeDaemon::onProcessError(QProcess::ProcessError error) {
    if (error == QProcess::FailedToStart)
        emit errorOccurred("'node' not found.\n  Install Node.js 18+.");
}

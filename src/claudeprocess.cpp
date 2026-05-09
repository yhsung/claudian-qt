#include "claudeprocess.h"
#include <QCoreApplication>
#include <QDir>
#include <QFile>
#include <QFileInfo>
#include <QJsonArray>
#include <QJsonDocument>
#include <QJsonObject>
#include <QProcessEnvironment>
#include <QStandardPaths>

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

static QString findBridgeScript() {
    // Production: inside app bundle at Contents/Resources/bridge/index.js
    const QString bundlePath = QCoreApplication::applicationDirPath()
                               + "/../Resources/bridge/index.js";
    const QFileInfo bundleInfo(bundlePath);
    if (bundleInfo.exists())
        return bundleInfo.canonicalFilePath();

    // Development: <project-root>/bridge/dist/index.js
    // Binary is at build/ClaudianQt.app/Contents/MacOS/ClaudianQt (4 levels up)
    const QString devPath = QCoreApplication::applicationDirPath()
                            + "/../../../bridge/dist/index.js";
    const QFileInfo devInfo(devPath);
    if (devInfo.exists())
        return devInfo.canonicalFilePath();

    return {};
}

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

    const QString nodePath   = findNodeBinary();
    const QString bridgePath = findBridgeScript();

    if (nodePath.isEmpty()) {
        emit errorOccurred("'node' not found.\n  Install Node.js 18+ to use the TypeScript bridge.");
        m_proc->deleteLater();
        m_proc = nullptr;
        return;
    }
    if (bridgePath.isEmpty()) {
        emit errorOccurred("Bridge script not found.\n  Run: cd bridge && npm install && npm run build");
        m_proc->deleteLater();
        m_proc = nullptr;
        return;
    }

    connect(m_proc, &QProcess::readyReadStandardOutput, this, &ClaudeProcess::onReadyRead);
    connect(m_proc, &QProcess::errorOccurred,           this, &ClaudeProcess::onProcessError);
    connect(m_proc, QOverload<int, QProcess::ExitStatus>::of(&QProcess::finished),
            this, [this](int exitCode, QProcess::ExitStatus) {
        onReadyRead();
        if (exitCode != 0) {
            const QString err = QString::fromUtf8(m_proc->readAllStandardError()).trimmed();
            if (!err.isEmpty()) emit errorOccurred(err);
        }
        emit turnFinished();
    });

    m_proc->start(nodePath, {bridgePath});
    if (!m_proc->waitForStarted(3000)) {
        emit errorOccurred("Failed to start bridge: " + bridgePath);
        m_proc->deleteLater();
        m_proc = nullptr;
        return;
    }

    QJsonObject cmd;
    cmd["prompt"]    = prompt;
    cmd["cwd"]       = cwd;
    cmd["sessionId"] = sessionId;
    cmd["model"]     = model;
    cmd["yolo"]      = yolo;
    m_proc->write(QJsonDocument(cmd).toJson(QJsonDocument::Compact) + "\n");
    m_proc->closeWriteChannel();
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
            qDebug() << "resultReceived:" << obj;
            emit resultReceived(obj);
        }
    }
}

void ClaudeProcess::onProcessError(QProcess::ProcessError error) {
    if (error == QProcess::FailedToStart)
        emit errorOccurred("'node' not found in PATH.\n  Install Node.js 18+ to use the TypeScript bridge.");
}

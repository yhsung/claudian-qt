#include "claudebridge.h"
#include <QDir>
#include <QFileDialog>
#include <QJsonObject>

ClaudeBridge::ClaudeBridge(QObject *parent)
    : QObject(parent)
    , m_daemon(new BridgeDaemon(this))
    , m_cwd(QDir::homePath())
{
    connect(m_daemon, &BridgeDaemon::sessionInitialized,   this, &ClaudeBridge::sessionReady);
    connect(m_daemon, &BridgeDaemon::textReady,            this, &ClaudeBridge::textReady);
    connect(m_daemon, &BridgeDaemon::toolUseStarted,       this, &ClaudeBridge::toolUse);
    connect(m_daemon, &BridgeDaemon::turnFinished,         this, &ClaudeBridge::turnComplete);
    connect(m_daemon, &BridgeDaemon::errorOccurred,        this, &ClaudeBridge::errorOccurred);
    connect(m_daemon, &BridgeDaemon::sessionsListed,       this, &ClaudeBridge::sessionsListed);
    connect(m_daemon, &BridgeDaemon::sessionHistoryLoaded, this, &ClaudeBridge::sessionHistoryLoaded);

    connect(m_daemon, &BridgeDaemon::daemonStarted, this, [this]() {
        m_daemon->sendCommand(QJsonObject{{"type", "set_cwd"},   {"cwd",   m_cwd}});
        if (!m_model.isEmpty())
            m_daemon->sendCommand(QJsonObject{{"type", "set_model"}, {"model", m_model}});
        if (m_yolo)
            m_daemon->sendCommand(QJsonObject{{"type", "set_yolo"},  {"yolo",  m_yolo}});
    });

    m_daemon->start();
}

void ClaudeBridge::sendMessage(const QString &text) {
    if (text.trimmed().isEmpty()) return;
    m_daemon->sendCommand(QJsonObject{{"type", "send"}, {"prompt", text.trimmed()}});
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

void ClaudeBridge::requestSessions() {
    m_daemon->sendCommand(QJsonObject{{"type", "request_sessions"}});
}

void ClaudeBridge::loadSession(const QString &sessionId) {
    m_daemon->sendCommand(QJsonObject{{"type", "load_session"}, {"sessionId", sessionId}});
}

void ClaudeBridge::newSession() {
    m_daemon->sendCommand(QJsonObject{{"type", "new_session"}});
}

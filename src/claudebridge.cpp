#include "claudebridge.h"
#include <QDir>
#include <QFileDialog>

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
    m_claude->send(text.trimmed(), m_cwd, m_sessionId);
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

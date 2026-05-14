#pragma once
#include <QByteArray>
#include <QJsonObject>
#include <QObject>
#include <QProcess>

// Manages one persistent Node.js daemon process.
// Sends JSON commands over stdin; reads typed JSON events from stdout.
class BridgeDaemon : public QObject {
    Q_OBJECT
public:
    explicit BridgeDaemon(QObject *parent = nullptr);
    ~BridgeDaemon();

    void start();
    void sendCommand(const QJsonObject &cmd);
    void abort();

signals:
    void daemonStarted();
    void sessionInitialized(const QString &sessionId);
    void textReady(const QString &text);
    void toolUseStarted(const QString &id, const QString &name, const QString &inputJson);
    void toolResultReceived(const QString &toolUseId, const QString &content, bool isError);
    void thinkingChunkReceived(const QString &text);
    void subAgentMessageReceived(const QString &parentToolUseId, const QString &text);
    void permissionRequested(const QString &requestId, const QString &toolName,
                             const QString &inputJson, const QString &title,
                             const QString &description, const QString &displayName,
                             const QString &decisionReason, const QString &blockedPath);
    void askUserQuestion(const QString &requestId, const QString &questionsJson);
    void turnFinished();
    void errorOccurred(const QString &msg);
    void sessionsListed(const QString &json);
    void sessionHistoryLoaded(const QString &json);
    void resultReceived(const QJsonObject &result);
    void toolProgress(const QString &id, const QString &name, double elapsedSeconds);
    void rateLimit(const QString &json);
    void fastModeStateChanged(const QString &state);
    void promptSuggestion(const QString &suggestion);
    void compactBoundary(const QString &json);
    void modelsListed(const QString &json);
    void sessionForked(const QString &newSessionId);
    void agentNotification(const QString &message, const QString &notificationType);
    void rewindResult(const QString &changedJson, const QString &restoredJson, const QString &failedJson);

private slots:
    void onReadyRead();
    void onDaemonFinished(int exitCode, QProcess::ExitStatus status);
    void onProcessError(QProcess::ProcessError error);

private:
    void handleEvent(const QJsonObject &event);
    void startDaemon();

    QProcess  *m_proc        = nullptr;
    QByteArray m_buffer;
    int        m_restartCount = 0;
};

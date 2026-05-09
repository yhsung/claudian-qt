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
    void sessionInitialized(const QString &sessionId);
    void textReady(const QString &text);
    void toolUseStarted(const QString &name, const QString &inputJson);
    void turnFinished();
    void errorOccurred(const QString &msg);
    void sessionsListed(const QString &json);
    void sessionHistoryLoaded(const QString &json);
    void resultReceived(const QJsonObject &result);

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

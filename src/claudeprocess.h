#pragma once
#include <QByteArray>
#include <QJsonObject>
#include <QObject>
#include <QProcess>

class ClaudeProcess : public QObject {
    Q_OBJECT
public:
    explicit ClaudeProcess(QObject *parent = nullptr);
    ~ClaudeProcess();

    void send(const QString &prompt, const QString &cwd,
              const QString &sessionId = {},
              const QString &model = {},
              bool yolo = false);
    void abort();

signals:
    void sessionInitialized(const QString &sessionId);
    void textReady(const QString &text);
    void toolUseStarted(const QString &name, const QString &inputJson);
    void turnFinished();
    void errorOccurred(const QString &msg);
    void resultReceived(const QJsonObject &result);

private slots:
    void onReadyRead();
    void onProcessError(QProcess::ProcessError error);

private:
    void parseLine(const QByteArray &line);
    void killCurrent();

    QProcess  *m_proc   = nullptr;
    QByteArray m_buffer;
};

#pragma once
#include <QObject>
#include "claudeprocess.h"

// Registered with QWebChannel as "claude".
// Public slots are callable from JS; signals are received by JS.
class ClaudeBridge : public QObject {
    Q_OBJECT
    Q_PROPERTY(QString cwd   READ cwd   NOTIFY cwdChanged)
    Q_PROPERTY(QString model READ model NOTIFY modelChanged)
    Q_PROPERTY(bool    yolo  READ yolo  NOTIFY yoloChanged)

public:
    explicit ClaudeBridge(QObject *parent = nullptr);

    QString cwd()   const { return m_cwd; }
    QString model() const { return m_model; }
    bool    yolo()  const { return m_yolo; }

public slots:
    void sendMessage(const QString &text);
    void abort();
    void setCwd(const QString &path);
    void setModel(const QString &model);
    void setYolo(bool enabled);
    void pickFolder(); // opens native folder dialog, then emits cwdChanged

signals:
    void textReady(const QString &text);
    void toolUse(const QString &name, const QString &inputJson);
    void turnComplete();
    void sessionReady(const QString &sessionId);
    void errorOccurred(const QString &msg);
    void cwdChanged(const QString &path);
    void modelChanged(const QString &model);
    void yoloChanged(bool enabled);

private:
    ClaudeProcess *m_claude;
    QString        m_sessionId;
    QString        m_cwd;
    QString        m_model;
    bool           m_yolo  = false;
};

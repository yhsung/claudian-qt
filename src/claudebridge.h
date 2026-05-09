#pragma once
#include <QObject>
#include "attachmentstore.h"
#include "bridgedaemon.h"

// Registered with QWebChannel as "claude".
// Public slots callable from JS; signals received by JS.
// All Claude operations delegated to BridgeDaemon.
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
    void sendMessage(const QString &text, const QString &attachmentsJson = "[]");
    void abort();
    void setCwd(const QString &path);
    void setModel(const QString &model);
    void setYolo(bool enabled);
    void pickFolder();
    void pickImages();
    void importImageData(
        const QString &requestId,
        const QString &originalName,
        const QString &mimeType,
        const QString &base64Data
    );
    void requestSessions();
    void loadSession(const QString &sessionId);
    void newSession();

signals:
    void textReady(const QString &text);
    void toolUse(const QString &name, const QString &inputJson);
    void turnComplete();
    void sessionReady(const QString &sessionId);
    void errorOccurred(const QString &msg);
    void cwdChanged(const QString &path);
    void modelChanged(const QString &model);
    void yoloChanged(bool enabled);
    void sessionsListed(const QString &json);
    void sessionHistoryLoaded(const QString &json);
    void imagesPicked(const QString &json);
    void imageImported(const QString &requestId, const QString &json);

private:
    BridgeDaemon    *m_daemon;
    AttachmentStore *m_attachmentStore;
    QString          m_cwd;
    QString          m_model;
    bool             m_yolo = false;
};

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
    void pasteImageFromClipboard();
    void requestSessions();
    void loadSession(const QString &sessionId);
    void newSession();
    void writeTextFile(const QString &suggestedName, const QString &content);
    void respondToPermission(const QString &requestId, bool allow, bool alwaysAllow);
    void respondToAskUser(const QString &requestId, const QString &answersJson);
    void deleteSession(const QString &sessionId);
    void renameSession(const QString &sessionId, const QString &name);
    void setPermissionMode(const QString &mode);
    void copyToClipboard(const QString &text);
    void requestModels();
    void setThinking(const QString &thinkingType, int budgetTokens = 8000);
    void setRunOptions(int maxTurns, double maxBudgetUsd, const QString &effort, const QString &systemPrompt);
    void setToolControls(const QString &allowedJson, const QString &disallowedJson);

signals:
    void textReady(const QString &text);
    void thinkingChunk(const QString &text);
    void toolUse(const QString &id, const QString &name, const QString &inputJson);
    void toolResult(const QString &toolUseId, const QString &content, bool isError);
    void subAgentMessage(const QString &parentToolUseId, const QString &text);
    void permissionRequested(const QString &requestId, const QString &toolName,
                             const QString &inputJson, const QString &title,
                             const QString &description, const QString &displayName,
                             const QString &decisionReason, const QString &blockedPath);
    void askUserQuestion(const QString &requestId, const QString &questionsJson);
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
    void usageUpdated(const QString &json);
    void fileWritten(bool success, const QString &path);
    void clipboardCopyRequested(const QString &text);
    void toolProgress(const QString &id, const QString &name, double elapsedSeconds);
    void rateLimit(const QString &json);
    void fastModeStateChanged(const QString &state);
    void promptSuggestion(const QString &suggestion);
    void compactBoundary(const QString &json);
    void modelsListed(const QString &json);

private:
    BridgeDaemon    *m_daemon;
    AttachmentStore *m_attachmentStore;
    QString          m_cwd;
    QString          m_model;
    bool             m_yolo = false;
};

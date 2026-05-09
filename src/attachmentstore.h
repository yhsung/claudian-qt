#pragma once

#include <QObject>

class AttachmentStore : public QObject {
    Q_OBJECT
public:
    explicit AttachmentStore(QObject *parent = nullptr);

    QString importFile(const QString &sourcePath);
    QString importBase64Image(
        const QString &originalName,
        const QString &mimeType,
        const QString &base64Data
    );

private:
    QString stagingRoot() const;
    QString importBytes(
        const QByteArray &bytes,
        const QString &originalName,
        const QString &mimeType
    );
    bool isSupportedImageMime(const QString &mimeType) const;
};

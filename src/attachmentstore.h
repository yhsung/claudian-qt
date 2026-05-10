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
    QString importBytes(
        const QByteArray &bytes,
        const QString &originalName,
        const QString &mimeType
    );

private:
    QString stagingRoot() const;
    bool isSupportedImageMime(const QString &mimeType) const;
};

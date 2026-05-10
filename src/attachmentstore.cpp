#include "attachmentstore.h"
#include <QBuffer>
#include <QDir>
#include <QFile>
#include <QFileInfo>
#include <QImage>
#include <QImageReader>
#include <QJsonDocument>
#include <QJsonObject>
#include <QMimeDatabase>
#include <QSaveFile>
#include <QStandardPaths>
#include <QUuid>

AttachmentStore::AttachmentStore(QObject *parent)
    : QObject(parent)
{
}

QString AttachmentStore::stagingRoot() const {
    const QString home = QDir::homePath();
    return home + "/.claudian-qt/attachments/staging";
}

QString AttachmentStore::importBytes(
    const QByteArray &bytes,
    const QString &originalName,
    const QString &mimeType
) {
    // If the format isn't Claude-supported (e.g. TIFF from macOS clipboard), convert to PNG.
    if (!isSupportedImageMime(mimeType)) {
        QImage img;
        if (!img.loadFromData(bytes)) return {};
        QByteArray pngBytes;
        QBuffer buf(&pngBytes);
        buf.open(QIODevice::WriteOnly);
        if (!img.save(&buf, "PNG")) return {};
        const QString pngName = QFileInfo(originalName).baseName() + ".png";
        return importBytes(pngBytes, pngName, "image/png");
    }

    QDir().mkpath(stagingRoot());
    const QString id = QUuid::createUuid().toString(QUuid::WithoutBraces);
    const QString path = stagingRoot() + "/" + id + "-" + QFileInfo(originalName).fileName();

    QSaveFile file(path);
    if (!file.open(QIODevice::WriteOnly)) return {};
    if (file.write(bytes) != static_cast<qint64>(bytes.size())) {
        file.cancelWriting();
        return {};
    }
    if (!file.commit()) return {};

    QImageReader reader(path);
    const QSize size = reader.size();

    return QString::fromUtf8(QJsonDocument(QJsonObject{
        {"id", id},
        {"originalName", originalName},
        {"mimeType", mimeType},
        {"stagedPath", path},
        {"fileUrl", "data:" + mimeType + ";base64," + QString::fromLatin1(bytes.toBase64())},
        {"sizeBytes", static_cast<qint64>(bytes.size())},
        {"width", size.isValid() ? size.width() : QJsonValue()},
        {"height", size.isValid() ? size.height() : QJsonValue()}
    }).toJson(QJsonDocument::Compact));
}

QString AttachmentStore::importFile(const QString &sourcePath) {
    QFile file(sourcePath);
    if (!file.open(QIODevice::ReadOnly)) return {};
    const QString mimeType = QMimeDatabase().mimeTypeForFile(sourcePath).name();
    return importBytes(file.readAll(), QFileInfo(sourcePath).fileName(), mimeType);
}

QString AttachmentStore::importBase64Image(
    const QString &originalName,
    const QString &mimeType,
    const QString &base64Data
) {
    const QByteArray bytes = QByteArray::fromBase64(base64Data.toUtf8());
    if (bytes.isEmpty()) return {};
    return importBytes(bytes, originalName, mimeType);
}

bool AttachmentStore::isSupportedImageMime(const QString &mimeType) const {
    return mimeType == "image/png"
        || mimeType == "image/jpeg"
        || mimeType == "image/gif"
        || mimeType == "image/webp";
}

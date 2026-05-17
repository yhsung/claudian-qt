#include "mainwindow.h"
#include <QDir>
#include <QStandardPaths>
#include <QWebEnginePage>
#include <QWebEngineSettings>

MainWindow::MainWindow(QWidget *parent)
    : QMainWindow(parent)
{
    setWindowTitle("ACE GUI");
    resize(960, 720);

    m_bridge  = new ClaudeBridge(this);
    m_channel = new QWebChannel(this);
    m_channel->registerObject("claude", m_bridge);

    // Remote debugging on port 9222 — connect via chrome://inspect or DevTools
    // Must be set before QWebEngineView is created
    qputenv("QTWEBENGINE_REMOTE_DEBUGGING", "9222");

    // Persistent profile: without this, Qt6 WebEngine treats the default profile
    // as off-the-record and localStorage is wiped on every restart.
    const QString dataDir = QStandardPaths::writableLocation(QStandardPaths::AppDataLocation);
    QDir().mkpath(dataDir);
    m_profile = new QWebEngineProfile(QStringLiteral("claudian-qt"), this);
    m_profile->setPersistentStoragePath(dataDir + QStringLiteral("/webstorage"));
    m_profile->setCachePath(dataDir + QStringLiteral("/webcache"));
    m_profile->setPersistentCookiesPolicy(QWebEngineProfile::ForcePersistentCookies);

    m_webView = new QWebEngineView(this);
    auto *page = new QWebEnginePage(m_profile, m_webView);
    m_webView->setPage(page);
    m_webView->page()->setWebChannel(m_channel);

    m_webView->settings()->setAttribute(
        QWebEngineSettings::LocalContentCanAccessFileUrls,
        true
    );
    m_webView->settings()->setAttribute(
        QWebEngineSettings::JavascriptCanAccessClipboard,
        true
    );

    m_webView->load(QUrl("qrc:/chat/index.html"));

    setCentralWidget(m_webView);
}

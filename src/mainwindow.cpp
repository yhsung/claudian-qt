#include "mainwindow.h"
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

    m_webView = new QWebEngineView(this);
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

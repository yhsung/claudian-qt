#include "mainwindow.h"

MainWindow::MainWindow(QWidget *parent)
    : QMainWindow(parent)
{
    setWindowTitle("Claudian Qt");
    resize(960, 720);

    m_bridge  = new ClaudeBridge(this);
    m_channel = new QWebChannel(this);
    m_channel->registerObject("claude", m_bridge);

    m_webView = new QWebEngineView(this);
    m_webView->page()->setWebChannel(m_channel);
    m_webView->load(QUrl("qrc:/chat/index.html"));

    setCentralWidget(m_webView);
}

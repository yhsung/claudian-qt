#pragma once
#include <QMainWindow>
#include <QWebChannel>
#include <QWebEngineProfile>
#include <QWebEngineView>
#include "claudebridge.h"

class MainWindow : public QMainWindow {
    Q_OBJECT
public:
    explicit MainWindow(QWidget *parent = nullptr);

private:
    QWebEngineProfile *m_profile;
    QWebEngineView    *m_webView;
    QWebChannel       *m_channel;
    ClaudeBridge      *m_bridge;
};

#include <QApplication>
#include "mainwindow.h"

int main(int argc, char *argv[]) {
    qputenv("QTWEBENGINE_REMOTE_DEBUGGING", "9222");
    QApplication app(argc, argv);
    app.setApplicationName("ACE GUI");
    app.setOrganizationName("ACE GUI");

    MainWindow w;
    w.show();

    return app.exec();
}

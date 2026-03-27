#include <QApplication>
#include "mainwindow.h"

int main(int argc, char *argv[]) {
    QApplication app(argc, argv);
    app.setApplicationName("ClaudianQt");
    app.setOrganizationName("ClaudianQt");

    MainWindow w;
    w.show();

    return app.exec();
}

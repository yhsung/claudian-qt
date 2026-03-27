cmake_minimum_required(VERSION 3.16)
project(ClaudianQt VERSION 0.1 LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_AUTOMOC ON)
set(CMAKE_AUTORCC ON)

find_package(Qt6 REQUIRED COMPONENTS Core Gui Widgets WebEngineWidgets WebChannel)

qt_add_executable(ClaudianQt
    src/main.cpp
    src/mainwindow.cpp
    src/claudeprocess.cpp
    src/claudebridge.cpp
    resources/resources.qrc
)

target_include_directories(ClaudianQt PRIVATE src)

target_link_libraries(ClaudianQt PRIVATE
    Qt6::Core
    Qt6::Gui
    Qt6::Widgets
    Qt6::WebEngineWidgets
    Qt6::WebChannel
)

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

set_target_properties(ClaudianQt PROPERTIES
    MACOSX_BUNDLE TRUE
    MACOSX_BUNDLE_BUNDLE_NAME "ClaudianQt"
    MACOSX_BUNDLE_GUI_IDENTIFIER "com.claudianqt.app"
    MACOSX_BUNDLE_BUNDLE_VERSION "${PROJECT_VERSION}"
    MACOSX_BUNDLE_SHORT_VERSION_STRING "${PROJECT_VERSION}"
)

target_include_directories(ClaudianQt PRIVATE src)

target_link_libraries(ClaudianQt PRIVATE
    Qt6::Core
    Qt6::Gui
    Qt6::Widgets
    Qt6::WebEngineWidgets
    Qt6::WebChannel
)

# Bundle the cocoa platform plugin and qt.conf so the app launches without QT_PLUGIN_PATH
file(GENERATE OUTPUT "${CMAKE_CURRENT_BINARY_DIR}/qt.conf"
    CONTENT "[Paths]\nPlugins = PlugIns\n")

add_custom_command(TARGET ClaudianQt POST_BUILD
    COMMAND ${CMAKE_COMMAND} -E make_directory
        "$<TARGET_BUNDLE_DIR:ClaudianQt>/Contents/PlugIns/platforms"
    COMMAND ${CMAKE_COMMAND} -E make_directory
        "$<TARGET_BUNDLE_DIR:ClaudianQt>/Contents/Resources"
    COMMAND ${CMAKE_COMMAND} -E copy_if_different
        "$<TARGET_FILE:Qt6::QCocoaIntegrationPlugin>"
        "$<TARGET_BUNDLE_DIR:ClaudianQt>/Contents/PlugIns/platforms/"
    COMMAND ${CMAKE_COMMAND} -E copy_if_different
        "${CMAKE_CURRENT_BINARY_DIR}/qt.conf"
        "$<TARGET_BUNDLE_DIR:ClaudianQt>/Contents/Resources/qt.conf"
)

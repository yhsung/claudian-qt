cmake_minimum_required(VERSION 3.26)
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

# ---------------------------------------------------------------------------
# TypeScript bridge: build and bundle into app
# ---------------------------------------------------------------------------
find_program(NPM_EXECUTABLE npm
    PATHS
        /opt/homebrew/bin
        /usr/local/bin
        $ENV{HOME}/.nvm/current/bin
        $ENV{HOME}/.volta/bin
        $ENV{HOME}/.fnm/current/bin
)
if(NPM_EXECUTABLE)
    add_custom_command(
        OUTPUT  "${CMAKE_SOURCE_DIR}/bridge/dist/index.js"
        COMMAND ${NPM_EXECUTABLE} install --prefer-offline
        COMMAND ${NPM_EXECUTABLE} run build
        DEPENDS
            "${CMAKE_SOURCE_DIR}/bridge/src/index.ts"
            "${CMAKE_SOURCE_DIR}/bridge/package.json"
            "${CMAKE_SOURCE_DIR}/bridge/tsconfig.json"
        WORKING_DIRECTORY "${CMAKE_SOURCE_DIR}/bridge"
        COMMENT "Building TypeScript Claude Agent SDK bridge"
        VERBATIM
    )
    add_custom_target(ClaudeBridge ALL
        DEPENDS "${CMAKE_SOURCE_DIR}/bridge/dist/index.js"
    )
    add_dependencies(ClaudianQt ClaudeBridge)

    # Copy dist/index.js into app bundle Resources/bridge/
    add_custom_command(TARGET ClaudianQt POST_BUILD
        COMMAND ${CMAKE_COMMAND} -E make_directory
            "$<TARGET_BUNDLE_DIR:ClaudianQt>/Contents/Resources/bridge"
        COMMAND ${CMAKE_COMMAND} -E copy_if_different
            "${CMAKE_SOURCE_DIR}/bridge/dist/index.js"
            "$<TARGET_BUNDLE_DIR:ClaudianQt>/Contents/Resources/bridge/index.js"
        COMMENT "Bundling TypeScript bridge into app bundle"
        VERBATIM
    )
    # Copy node_modules into app bundle so Node can resolve imports at runtime
    add_custom_command(TARGET ClaudianQt POST_BUILD
        COMMAND ${CMAKE_COMMAND} -E copy_directory_if_different
            "${CMAKE_SOURCE_DIR}/bridge/node_modules"
            "$<TARGET_BUNDLE_DIR:ClaudianQt>/Contents/Resources/bridge/node_modules"
        COMMENT "Copying bridge node_modules into app bundle"
        VERBATIM
    )
else()
    message(WARNING "npm not found — bridge will not be built automatically. "
                    "Run: cd bridge && npm install && npm run build")
endif()

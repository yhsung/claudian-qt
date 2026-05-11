cmake_minimum_required(VERSION 3.16)
project(ClaudianQt VERSION 0.1 LANGUAGES CXX)

enable_testing()

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_AUTOMOC ON)
set(CMAKE_AUTORCC ON)

find_package(Qt6 REQUIRED COMPONENTS Core Gui Widgets WebEngineWidgets WebChannel)

qt_add_executable(ClaudianQt
    src/main.cpp
    src/mainwindow.cpp
    src/bridgedaemon.cpp
    src/claudebridge.cpp
    src/attachmentstore.cpp
    resources/resources.qrc
)

if(APPLE)
    set_target_properties(ClaudianQt PROPERTIES
        MACOSX_BUNDLE TRUE
        MACOSX_BUNDLE_BUNDLE_NAME "ClaudianQt"
        MACOSX_BUNDLE_GUI_IDENTIFIER "com.claudianqt.app"
        MACOSX_BUNDLE_BUNDLE_VERSION "${PROJECT_VERSION}"
        MACOSX_BUNDLE_SHORT_VERSION_STRING "${PROJECT_VERSION}"
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
endif()

target_include_directories(ClaudianQt PRIVATE src)

target_link_libraries(ClaudianQt PRIVATE
    Qt6::Core
    Qt6::Gui
    Qt6::Widgets
    Qt6::WebEngineWidgets
    Qt6::WebChannel
)

# ---------------------------------------------------------------------------
# Windows: run windeployqt to bundle Qt DLLs and WebEngine resources
# ---------------------------------------------------------------------------
if(WIN32)
    find_program(WINDEPLOYQT_EXECUTABLE windeployqt
        HINTS "${Qt6_DIR}/../../../bin"
    )
    if(WINDEPLOYQT_EXECUTABLE)
        add_custom_command(TARGET ClaudianQt POST_BUILD
            COMMAND "${WINDEPLOYQT_EXECUTABLE}"
                --no-translations
                --no-system-d3d-compiler
                --no-opengl-sw
                "$<TARGET_FILE:ClaudianQt>"
            COMMENT "Running windeployqt"
            VERBATIM
        )
    else()
        message(WARNING "windeployqt not found — run it manually: windeployqt build/Release/ClaudianQt.exe")
    endif()
endif()

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
        OUTPUT  "${CMAKE_SOURCE_DIR}/bridge/dist/daemon.js"
        COMMAND ${NPM_EXECUTABLE} install --prefer-offline
        COMMAND ${NPM_EXECUTABLE} run build
        DEPENDS
            "${CMAKE_SOURCE_DIR}/bridge/src/daemon.ts"
            "${CMAKE_SOURCE_DIR}/bridge/src/protocol.ts"
            "${CMAKE_SOURCE_DIR}/bridge/src/session-history.ts"
            "${CMAKE_SOURCE_DIR}/bridge/package.json"
            "${CMAKE_SOURCE_DIR}/bridge/tsconfig.json"
        WORKING_DIRECTORY "${CMAKE_SOURCE_DIR}/bridge"
        COMMENT "Building TypeScript Claude Agent SDK bridge"
        VERBATIM
    )
    add_custom_target(ClaudeBridge ALL
        DEPENDS "${CMAKE_SOURCE_DIR}/bridge/dist/daemon.js"
    )
    add_dependencies(ClaudianQt ClaudeBridge)

    if(APPLE)
        # Sync daemon dist after TS-only rebuilds (ClaudianQt's POST_BUILD only runs on relink).
        add_custom_command(TARGET ClaudeBridge POST_BUILD
            COMMAND ${CMAKE_COMMAND} -E make_directory
                "${CMAKE_BINARY_DIR}/ClaudianQt.app/Contents/Resources/bridge"
            COMMAND ${CMAKE_COMMAND} -E copy_directory
                "${CMAKE_SOURCE_DIR}/bridge/dist"
                "${CMAKE_BINARY_DIR}/ClaudianQt.app/Contents/Resources/bridge"
            COMMENT "Syncing daemon dist to app bundle after TS rebuild"
            VERBATIM
        )

        # Copy entire dist/ into app bundle Resources/bridge/
        add_custom_command(TARGET ClaudianQt POST_BUILD
            COMMAND ${CMAKE_COMMAND} -E make_directory
                "$<TARGET_BUNDLE_DIR:ClaudianQt>/Contents/Resources/bridge"
            COMMAND ${CMAKE_COMMAND} -E copy_directory
                "${CMAKE_SOURCE_DIR}/bridge/dist"
                "$<TARGET_BUNDLE_DIR:ClaudianQt>/Contents/Resources/bridge"
            COMMENT "Bundling TypeScript daemon dist into app bundle"
            VERBATIM
        )
        add_custom_command(TARGET ClaudianQt POST_BUILD
            COMMAND ${CMAKE_COMMAND} -E copy_directory
                "${CMAKE_SOURCE_DIR}/bridge/node_modules"
                "$<TARGET_BUNDLE_DIR:ClaudianQt>/Contents/Resources/bridge/node_modules"
            COMMENT "Copying bridge node_modules into app bundle"
            VERBATIM
        )
    else()
        # Windows: copy bridge dist next to the executable (build/<Config>/bridge/)
        add_custom_command(TARGET ClaudeBridge POST_BUILD
            COMMAND ${CMAKE_COMMAND} -E make_directory
                "${CMAKE_BINARY_DIR}/$<CONFIG>/bridge"
            COMMAND ${CMAKE_COMMAND} -E copy_directory
                "${CMAKE_SOURCE_DIR}/bridge/dist"
                "${CMAKE_BINARY_DIR}/$<CONFIG>/bridge"
            COMMENT "Syncing daemon dist next to executable after TS rebuild"
            VERBATIM
        )

        add_custom_command(TARGET ClaudianQt POST_BUILD
            COMMAND ${CMAKE_COMMAND} -E make_directory
                "$<TARGET_FILE_DIR:ClaudianQt>/bridge"
            COMMAND ${CMAKE_COMMAND} -E copy_directory
                "${CMAKE_SOURCE_DIR}/bridge/dist"
                "$<TARGET_FILE_DIR:ClaudianQt>/bridge"
            COMMENT "Bundling TypeScript daemon dist next to executable"
            VERBATIM
        )
        add_custom_command(TARGET ClaudianQt POST_BUILD
            COMMAND ${CMAKE_COMMAND} -E copy_directory
                "${CMAKE_SOURCE_DIR}/bridge/node_modules"
                "$<TARGET_FILE_DIR:ClaudianQt>/bridge/node_modules"
            COMMENT "Copying bridge node_modules next to executable"
            VERBATIM
        )
    endif()

    add_test(
        NAME BridgeTests
        COMMAND ${NPM_EXECUTABLE} test
        WORKING_DIRECTORY ${CMAKE_SOURCE_DIR}/bridge
    )
else()
    message(WARNING "npm not found — bridge will not be built automatically. "
                    "Run: cd bridge && npm install && npm run build")
endif()

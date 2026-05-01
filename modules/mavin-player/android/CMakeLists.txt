cmake_minimum_required(VERSION 3.13)

find_package(ReactAndroid REQUIRED CONFIG)
find_package(fbjni REQUIRED CONFIG)

add_library(
  mavin_player
  SHARED
  src/main/java/com/doublesymmetry/trackplayer/module/OnLoad.cpp
)

target_link_libraries(
  mavin_player
  ReactAndroid::jsi
  ReactAndroid::react_nativemodule_core
  ReactAndroid::turbomodulejsijni
  ReactAndroid::react_codegen_TrackPlayerSpec
  fbjni::fbjni
)

package com.doublesymmetry.trackplayer.extensions

import kotlin.reflect.KProperty1

fun <T : Enum<T>> KProperty1<T, String>.find(value: String?): T? {
    val enumClass = this.javaClass.enclosingClass ?: return null
    @Suppress("UNCHECKED_CAST")
    val constants = (enumClass as Class<T>).enumConstants ?: return null
    return constants.firstOrNull { this.get(it) == value }
}

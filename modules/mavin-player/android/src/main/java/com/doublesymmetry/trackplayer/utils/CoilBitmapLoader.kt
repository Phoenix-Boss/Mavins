package com.doublesymmetry.trackplayer.utils

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.drawable.BitmapDrawable
import android.net.Uri
import android.os.Build
import androidx.media3.common.util.BitmapLoader
import androidx.media3.common.util.Util.isBitmapFactorySupportedMimeType
import androidx.media3.common.util.UnstableApi
import coil.ImageLoader
import coil.request.ImageRequest
import coil.transform.Transformation
import com.google.common.util.concurrent.ListenableFuture
import kotlinx.coroutines.MainScope
import kotlinx.coroutines.guava.future
import java.io.IOException
import javax.inject.Inject

// https://github.com/androidx/media/issues/121
// Fixed (April 2026): replaced coil3.* imports with coil.* (Coil 2.x API).
// coil3 is a separate artifact requiring explicit migration; this project
// uses Coil 2.x on the classpath.

@UnstableApi
class CoilBitmapLoader @Inject constructor(
    private val context: Context,
    private val cropSquare: Boolean = false,
) : BitmapLoader {

    private val scope       = MainScope()
    private val imageLoader = ImageLoader(context)

    override fun supportsMimeType(mimeType: String): Boolean =
        isBitmapFactorySupportedMimeType(mimeType)

    override fun decodeBitmap(data: ByteArray): ListenableFuture<Bitmap> = scope.future {
        BitmapFactory.decodeByteArray(data, 0, data.size)
            ?: throw IOException("Unable to decode bitmap")
    }

    override fun loadBitmap(uri: Uri): ListenableFuture<Bitmap> = scope.future {
        val requestBuilder = ImageRequest.Builder(context)
            .data(uri)
            .allowHardware(false)

        val request = if (Build.MANUFACTURER.equals("samsung", ignoreCase = true) || cropSquare) {
            requestBuilder.transformations(CropSquareTransformation).build()
        } else {
            requestBuilder.build()
        }

        val response = imageLoader.execute(request)
        (response.drawable as? BitmapDrawable)?.bitmap
            ?: throw IOException("Unable to load bitmap: $uri")
    }
}

/** Coil 2.x square-crop transformation (no external jp.wasabeef dependency). */
private object CropSquareTransformation : Transformation {
    override val cacheKey: String = "CropSquareTransformation"

    override suspend fun transform(input: Bitmap, size: coil.size.Size): Bitmap {
        val min = minOf(input.width, input.height)
        val x   = (input.width  - min) / 2
        val y   = (input.height - min) / 2
        return Bitmap.createBitmap(input, x, y, min, min)
    }
}

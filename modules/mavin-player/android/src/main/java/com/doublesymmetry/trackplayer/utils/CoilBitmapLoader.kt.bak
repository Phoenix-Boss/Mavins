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

@UnstableApi
class CoilBitmapLoader @Inject constructor(
    private val context: Context,
    private val cropSquare: Boolean = false,
) : BitmapLoader {
    private val scope       = MainScope()
    private val imageLoader = ImageLoader(context)

    override fun supportsMimeType(mimeType: String) = isBitmapFactorySupportedMimeType(mimeType)

    override fun decodeBitmap(data: ByteArray): ListenableFuture<Bitmap> = scope.future {
        BitmapFactory.decodeByteArray(data, 0, data.size) ?: throw IOException("Unable to decode bitmap")
    }

    override fun loadBitmap(uri: Uri): ListenableFuture<Bitmap> = scope.future {
        val req = ImageRequest.Builder(context).data(uri).allowHardware(false).let {
            if (Build.MANUFACTURER.equals("samsung", ignoreCase = true) || cropSquare)
                it.transformations(CropSquareTransformation) else it
        }.build()
        (imageLoader.execute(req).drawable as? BitmapDrawable)?.bitmap
            ?: throw IOException("Unable to load bitmap: $uri")
    }
}

private object CropSquareTransformation : Transformation {
    override val cacheKey = "CropSquareTransformation"
    override suspend fun transform(input: Bitmap, size: coil.size.Size): Bitmap {
        val min = minOf(input.width, input.height)
        return Bitmap.createBitmap(input, (input.width - min) / 2, (input.height - min) / 2, min, min)
    }
}

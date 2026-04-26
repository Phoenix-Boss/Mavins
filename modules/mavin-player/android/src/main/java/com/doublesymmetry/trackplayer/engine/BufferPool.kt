package com.doublesymmetry.trackplayer.engine

import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.util.concurrent.ConcurrentLinkedQueue

/**
 * BufferPool - zero-copy ring buffer pool for DSP pipeline.
 * Poweramp/Neutron pattern: pre-allocated direct buffers reused across
 * decoder -> DSP -> output threads to eliminate GC pressure.
 */
class BufferPool(private val bufferSize: Int = 65536, private val poolSize: Int = 8) {
    private val pool = ConcurrentLinkedQueue<ByteBuffer>()

    init {
        repeat(poolSize) {
            pool.add(allocate())
        }
    }

    private fun allocate(): ByteBuffer {
        return ByteBuffer.allocateDirect(bufferSize).order(ByteOrder.nativeOrder())
    }

    fun acquire(): ByteBuffer {
        val buffer = pool.poll()
        return if (buffer != null) {
            buffer.clear()
            buffer
        } else {
            allocate()
        }
    }

    fun release(buffer: ByteBuffer) {
        buffer.clear()
        pool.add(buffer)
    }

    fun clear() {
        pool.clear()
    }
}
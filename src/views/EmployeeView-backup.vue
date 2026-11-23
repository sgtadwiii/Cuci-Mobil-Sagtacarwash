
<script setup>
import { ref, onMounted, onUnmounted } from 'vue'
import { supabase } from '../services/supabase'

const video = ref(null)
const canvas = ref(null)
const stream = ref(null)

const employeeName = ref('Budi Santoso')
const cameraActive = ref(false)
const loading = ref(false)
const message = ref('')
const messageType = ref('success')
const coordinates = ref(null)
const photoPreview = ref(null)

async function startCamera() {
  try {
    stream.value = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: 'user',
        width: { ideal: 1280 },
        height: { ideal: 720 }
      },
      audio: false
    })

    video.value.srcObject = stream.value
    await video.value.play()
    cameraActive.value = true
  } catch (error) {
    showMessage('Tidak dapat mengakses kamera: ' + error.message, 'error')
  }
}

function stopCamera() {
  stream.value?.getTracks().forEach(track => track.stop())
  stream.value = null
  cameraActive.value = false
}


function getLocation() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error('Browser tidak mendukung GPS'))
      return
    }

    navigator.geolocation.getCurrentPosition(
      position => {
        resolve({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracy: position.coords.accuracy
        })
      },

      error => {
        let message = ''
        switch (error.code) {
          case 1:
            message = 'Izin lokasi ditolak. Aktifkan Location pada pengaturan browser.'
            break
          case 2:
            message = 'Lokasi tidak tersedia. Periksa Location Services perangkat.'
            break
          case 3:
            message = 'GPS timeout. Coba lagi atau gunakan perangkat lain.'
            break
          default:
            message = 'Terjadi kesalahan saat mengambil lokasi.'
        }
        reject(new Error(message))
      },

{
  enableHighAccuracy: false,
  timeout: 30000,
  maximumAge: 10000
}
    )
  })
}


function capturePhoto() {
  if (!video.value || !video.value.videoWidth) {
    throw new Error('Kamera belum siap')
  }

  const element = canvas.value
  element.width = video.value.videoWidth
  element.height = video.value.videoHeight

  const context = element.getContext('2d')

  // Mirror agar hasil selfie terlihat natural
  context.translate(element.width, 0)
  context.scale(-1, 1)
  context.drawImage(
    video.value,
    0,
    0,
    element.width,
    element.height
  )

  return new Promise((resolve, reject) => {
    element.toBlob(blob => {
      if (!blob) {
        reject(new Error('Gagal mengambil foto'))
        return
      }

      resolve(blob)
    }, 'image/jpeg', 0.85)
  })
}

function showMessage(text, type = 'success') {
  message.value = text
  messageType.value = type
}

async function submitAttendance() {
  if (loading.value) return

  if (!cameraActive.value) {
    showMessage('Aktifkan kamera terlebih dahulu', 'error')
    return
  }

  if (!employeeName.value.trim()) {
    showMessage('Nama karyawan wajib diisi', 'error')
    return
  }

  loading.value = true
  message.value = ''

  try {
    // 1. Ambil foto
    const photoBlob = await capturePhoto()
    photoPreview.value = URL.createObjectURL(photoBlob)

    // 2. Ambil lokasi GPS
    const location = await getLocation()
    coordinates.value = location

    // 3. Upload foto ke Supabase Storage
    const fileName = `${crypto.randomUUID()}.jpg`
    const photoPath = `demo/${fileName}`

    const { error: uploadError } = await supabase.storage
      .from('attendance-photos')
      .upload(photoPath, photoBlob, {
        contentType: 'image/jpeg',
        upsert: false
      })

    if (uploadError) throw uploadError

    // 4. Simpan data absensi
    const { error: insertError } = await supabase
      .from('attendance')
      .insert({
        employee_name: employeeName.value.trim(),
        photo_path: photoPath,
        latitude: location.latitude,
        longitude: location.longitude,
        accuracy: location.accuracy,
        attendance_type: 'check_in'
      })

    if (insertError) throw insertError

    showMessage(
      'Absensi berhasil! Foto dan lokasi sudah dikirim ke admin.',
      'success'
    )

  } catch (error) {
    console.error(error)
    showMessage(
      'Absensi gagal: ' + error.message,
      'error'
    )
  } finally {
    loading.value = false
  }
}

onMounted(() => {
  // Kamera baru aktif setelah pengguna menekan tombol.
})

onUnmounted(() => {
  stopCamera()

  if (photoPreview.value) {
    URL.revokeObjectURL(photoPreview.value)
  }
})
</script>

<template>
  <div class="employee-page">
    <header class="employee-header">
      <div class="brand">
        <div class="brand-icon">CW</div>
        <div>
          <h2>CarWash Attendance</h2>
          <p>Employee Portal</p>
        </div>
      </div>

      <span class="online-status">
        <span></span> Online
      </span>
    </header>

    <main class="employee-content">
      <div class="welcome-text">
        <span class="eyebrow">EMPLOYEE ATTENDANCE</span>
        <h1>Selamat Datang!</h1>
        <p>Silakan lakukan absensi di lokasi kerja Anda.</p>
      </div>

      <section class="attendance-card">
        <div class="card-heading">
          <div>
            <h3>Absensi Masuk</h3>
            <p>Ambil foto selfie sebelum melakukan absensi.</p>
          </div>
          <span class="camera-icon">📷</span>
        </div>

        <div class="camera-container">
          <video
            ref="video"
            v-show="cameraActive"
            autoplay
            muted
            playsinline
          ></video>

          <div v-if="!cameraActive" class="camera-placeholder">
            <div class="camera-placeholder-icon">📸</div>
            <h3>Kamera belum aktif</h3>
            <p>Aktifkan kamera untuk memulai absensi.</p>
          </div>
        </div>

        <canvas ref="canvas" hidden></canvas>

        <div class="form-group">
          <label>Nama Karyawan</label>
          <input
            v-model="employeeName"
            type="text"
            placeholder="Masukkan nama karyawan"
          />
          <small>Nama sementara untuk demonstrasi.</small>
        </div>

        <button
          v-if="!cameraActive"
          class="btn-secondary"
          @click="startCamera"
        >
          📷 Aktifkan Kamera
        </button>

        <button
          v-else
          class="btn-primary"
          :disabled="loading"
          @click="submitAttendance"
        >
          {{ loading ? 'Mengirim Absensi...' : '📍 ABSEN SEKARANG' }}
        </button>

        <button
          v-if="cameraActive"
          class="btn-stop"
          @click="stopCamera"
          :disabled="loading"
        >
          Matikan Kamera
        </button>

        <div
          v-if="message"
          class="message-box"
          :class="messageType"
        >
          {{ message }}
        </div>

        <div v-if="coordinates" class="location-info">
          <h4>📍 Lokasi Terdeteksi</h4>
          <p>Latitude: {{ coordinates.latitude }}</p>
          <p>Longitude: {{ coordinates.longitude }}</p>
          <p>Akurasi: ±{{ Math.round(coordinates.accuracy) }} meter</p>
        </div>
      </section>

      <p class="footer-note">
        CarWash Attendance · Prototype V1
      </p>
    </main>
  </div>
</template>

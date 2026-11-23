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
const cameraError = ref('')

// ============ KAMERA ============
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

    if (video.value) {
      video.value.srcObject = stream.value
      await video.value.play()
      cameraActive.value = true
      cameraError.value = ''
    }
  } catch (error) {
    cameraActive.value = false
    cameraError.value =
      'Kamera belum dapat diakses. Izinkan akses kamera pada browser lalu muat ulang halaman.'
    showMessage(cameraError.value + ' ' + error.message, 'error')
  }
}

function stopCamera() {
  stream.value?.getTracks().forEach(track => track.stop())
  stream.value = null
  cameraActive.value = false
}

// ============ GPS ============
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
        let msg = ''
        switch (error.code) {
          case 1:
            msg = 'Izin lokasi ditolak. Aktifkan Location pada pengaturan browser.'
            break
          case 2:
            msg = 'Lokasi tidak tersedia. Periksa Location Services perangkat.'
            break
          case 3:
            msg = 'GPS timeout. Coba lagi atau gunakan perangkat lain.'
            break
          default:
            msg = 'Terjadi kesalahan saat mengambil lokasi.'
        }
        reject(new Error(msg))
      },
      {
        enableHighAccuracy: true,
        timeout: 30000,
        maximumAge: 10000
      }
    )
  })
}

// ============ CAPTURE ============
function capturePhoto() {
  if (!video.value || !video.value.videoWidth) {
    throw new Error('Kamera belum siap')
  }

  const element = canvas.value
  element.width = video.value.videoWidth
  element.height = video.value.videoHeight

  const context = element.getContext('2d')
  context.translate(element.width, 0)
  context.scale(-1, 1)
  context.drawImage(video.value, 0, 0, element.width, element.height)

  return new Promise((resolve, reject) => {
    element.toBlob(
      blob => {
        if (!blob) {
          reject(new Error('Gagal mengambil foto'))
          return
        }
        resolve(blob)
      },
      'image/jpeg',
      0.85
    )
  })
}

function showMessage(text, type = 'success') {
  message.value = text
  messageType.value = type
}

// ============ SUBMIT ============
async function submitAttendance() {
  if (loading.value) return

  if (!cameraActive.value) {
    showMessage('Kamera belum aktif. Mohon tunggu sebentar atau muat ulang halaman.', 'error')
    return
  }

  if (!employeeName.value.trim()) {
    showMessage('Nama karyawan wajib diisi', 'error')
    return
  }

  loading.value = true
  message.value = ''

  try {
    const photoBlob = await capturePhoto()
    const location = await getLocation()
    coordinates.value = location

    const fileName = `${crypto.randomUUID()}.jpg`

    const { data: uploadData, error: uploadError } = await supabase.storage
      .from('attendance-photos')
      .upload(fileName, photoBlob, {
        contentType: 'image/jpeg',
        upsert: false
      })

    if (uploadError) throw uploadError

    const { error: insertError } = await supabase
      .from('attendance')
      .insert({
        employee_name: employeeName.value.trim(),
        photo_path: uploadData.path,
        latitude: location.latitude,
        longitude: location.longitude,
        accuracy: location.accuracy,
        attendance_type: 'check_in'
      })

    if (insertError) throw insertError

    showMessage('Absensi berhasil! Foto dan lokasi sudah dikirim ke admin.', 'success')
  } catch (error) {
    console.error(error)
    showMessage('Absensi gagal: ' + error.message, 'error')
  } finally {
    loading.value = false
  }
}

// ============ LIFECYCLE ============
onMounted(async () => {
  await startCamera()
})

onUnmounted(() => {
  stopCamera()
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

        <!-- Video stream tersembunyi: kamera tetap jalan untuk capture -->
        <video
          ref="video"
          class="camera-stream-hidden"
          autoplay
          muted
          playsinline
        ></video>
        <canvas ref="canvas" hidden></canvas>

        <!-- Status kamera (info kecil, bukan button) -->
        <div v-if="!cameraActive" class="camera-status">
          <p>⏳ Menyiapkan kamera...</p>
        </div>

        <div class="form-group">
          <label>Nama Karyawan</label>
          <input
            v-model="employeeName"
            type="text"
            placeholder="Masukkan nama karyawan"
          />
          <small>Nama sementara untuk demonstrasi.</small>
        </div>

        <!-- HANYA tombol absen -->
        <button
          class="btn-primary"
          :disabled="loading || !cameraActive"
          @click="submitAttendance"
        >
          {{ loading ? 'Mengirim Absensi...' : cameraActive ? '📍 ABSEN SEKARANG' : 'Menyiapkan Kamera...' }}
        </button>

        <div v-if="message" class="message-box" :class="messageType">
          {{ message }}
        </div>

        <div v-if="coordinates" class="location-info">
          <h4>📍 Lokasi Terdeteksi</h4>
          <p>Latitude: {{ coordinates.latitude }}</p>
          <p>Longitude: {{ coordinates.longitude }}</p>
          <p>Akurasi: ±{{ Math.round(coordinates.accuracy) }} meter</p>
        </div>
      </section>

      <p class="footer-note">CarWash Attendance · Prototype V1</p>
    </main>
  </div>
</template>

<style scoped>
/* Sembunyikan video stream sepenuhnya dari tampilan */
.camera-stream-hidden {
  position: absolute;
  width: 1px;
  height: 1px;
  opacity: 0;
  pointer-events: none;
  overflow: hidden;
}

.camera-status {
  text-align: center;
  padding: 12px;
  background: #fff7e6;
  border: 1px solid #ffe0a3;
  border-radius: 10px;
  color: #8a6d3b;
  font-size: 14px;
  margin-bottom: 16px;
}
</style>
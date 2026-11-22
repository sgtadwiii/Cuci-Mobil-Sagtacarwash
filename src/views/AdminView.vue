
<script setup>
import { ref, onMounted, onUnmounted, nextTick } from 'vue'
import { supabase } from '../services/supabase'
import L from 'leaflet'

const attendances = ref([])
const loading = ref(true)
const errorMessage = ref('')
const mapElement = ref(null)

let map = null
let markerLayer = null
let realtimeChannel = null

const totalAttendance = ref(0)

function formatDate(date) {
  return new Date(date).toLocaleString('id-ID', {
    dateStyle: 'medium',
    timeStyle: 'short'
  })
}

function getPhotoUrl(path) {
  const { data } = supabase.storage
    .from('attendance-photos')
    .getPublicUrl(path)

  return data.publicUrl
}

async function fetchAttendance() {
  const { data, error } = await supabase
    .from('attendance')
    .select('*')
    .order('created_at', { ascending: false })

  if (error) {
    errorMessage.value = error.message
    return
  }

  attendances.value = data || []
  totalAttendance.value = attendances.value.length

  updateMarkers()
}

function initializeMap() {
  if (!mapElement.value || map) return

  map = L.map(mapElement.value).setView([-2.5, 118], 4)

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; OpenStreetMap contributors'
  }).addTo(map)

  markerLayer = L.layerGroup().addTo(map)
}

function updateMarkers() {
  if (!map || !markerLayer) return

  markerLayer.clearLayers()

  const validCoordinates = []

  attendances.value.forEach(item => {
    const lat = Number(item.latitude)
    const lng = Number(item.longitude)

    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return

    const marker = L.marker([lat, lng]).addTo(markerLayer)

    marker.bindPopup(`
      <strong>${escapeHtml(item.employee_name)}</strong><br>
      ${formatDate(item.created_at)}
    `)

    validCoordinates.push([lat, lng])
  })

  if (validCoordinates.length === 1) {
    map.setView(validCoordinates[0], 16)
  } else if (validCoordinates.length > 1) {
    map.fitBounds(validCoordinates, { padding: [30, 30] })
  }
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, char => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  })[char])
}

function subscribeRealtime() {
  realtimeChannel = supabase
    .channel('attendance-live')
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'attendance'
      },
      async () => {
        await fetchAttendance()
      }
    )
    .subscribe()
}

onMounted(async () => {
  loading.value = true

  await nextTick()
  initializeMap()
  await fetchAttendance()
  subscribeRealtime()

  loading.value = false
})

onUnmounted(() => {
  if (realtimeChannel) {
    supabase.removeChannel(realtimeChannel)
  }

  if (map) {
    map.remove()
    map = null
  }
})
</script>

<template>
  <div class="admin-page">
    <aside class="sidebar">
      <div class="brand">
        <div class="brand-icon">CW</div>
        <div>
          <h2>CarWash</h2>
          <p>Management System</p>
        </div>
      </div>

      <div class="sidebar-label">MENU UTAMA</div>

      <div class="sidebar-menu active">
        <span>▦</span> Dashboard
      </div>

      <div class="sidebar-menu">
        <span>👥</span> Data Karyawan
      </div>

      <div class="sidebar-menu">
        <span>📍</span> Lokasi Absensi
      </div>

      <div class="sidebar-bottom">
        <span class="admin-avatar">A</span>
        <div>
          <strong>Administrator</strong>
          <small>Admin Demo</small>
        </div>
      </div>
    </aside>

    <main class="admin-main">
      <header class="admin-header">
        <div>
          <span class="eyebrow">OVERVIEW</span>
          <h1>Dashboard Absensi</h1>
          <p>Monitoring kehadiran karyawan secara langsung.</p>
        </div>

        <div class="live-indicator">
          <span></span> Live Monitoring
        </div>
      </header>

      <section class="stat-grid">
        <div class="stat-card">
          <span>Total Absensi</span>
          <strong>{{ totalAttendance }}</strong>
          <small>Seluruh data demo</small>
        </div>

        <div class="stat-card">
          <span>Status Sistem</span>
          <strong class="system-online">Online</strong>
          <small>Terhubung ke Supabase</small>
        </div>

        <div class="stat-card">
          <span>Realtime</span>
          <strong class="system-online">Aktif</strong>
          <small>Menunggu absensi baru</small>
        </div>
      </section>

      <section class="map-card">
        <div class="section-heading">
          <div>
            <h2>Peta Lokasi Karyawan</h2>
            <p>Lokasi berdasarkan koordinat GPS yang dikirim.</p>
          </div>
          <span class="map-badge">GPS Location</span>
        </div>

        <div ref="mapElement" class="attendance-map"></div>
      </section>

      <section class="table-card">
        <div class="section-heading">
          <div>
            <h2>Aktivitas Absensi</h2>
            <p>Data absensi yang diterima dari karyawan.</p>
          </div>

          <button class="refresh-button" @click="fetchAttendance">
            ↻ Refresh
          </button>
        </div>

        <div v-if="loading" class="empty-state">
          Memuat data absensi...
        </div>

        <div v-else-if="errorMessage" class="empty-state error">
          {{ errorMessage }}
        </div>

        <div v-else-if="attendances.length === 0" class="empty-state">
          <div class="empty-icon">📋</div>
          <h3>Belum ada absensi</h3>
          <p>Data akan muncul ketika karyawan melakukan absensi.</p>
        </div>

        <div v-else class="attendance-list">
          <div
            v-for="item in attendances"
            :key="item.id"
            class="attendance-item"
          >
            <img
              :src="getPhotoUrl(item.photo_path)"
              :alt="item.employee_name"
              class="employee-photo"
            />

            <div class="employee-info">
              <strong>{{ item.employee_name }}</strong>
              <small>{{ formatDate(item.created_at) }}</small>
              <span class="attendance-type">
                {{ item.attendance_type === 'check_in' ? 'Absen Masuk' : 'Absen Pulang' }}
              </span>
            </div>

            <div class="coordinate-info">
              <strong>Koordinat GPS</strong>
              <small>{{ Number(item.latitude).toFixed(6) }}</small>
              <small>{{ Number(item.longitude).toFixed(6) }}</small>
              <small>Akurasi ±{{ Math.round(item.accuracy || 0) }} m</small>
            </div>

            <button
              class="location-button"
              @click="map?.setView([item.latitude, item.longitude], 17)"
            >
              📍 Lihat Lokasi
            </button>
          </div>
        </div>
      </section>

      <p class="footer-note">
        CarWash Attendance · Admin Dashboard · Prototype V1
      </p>
    </main>
  </div>
</template>

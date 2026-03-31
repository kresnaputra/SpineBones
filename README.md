# SpineBones

SpineBones adalah editor skeleton 2D untuk membuat rig sederhana, memasang gambar ke bone melalui slot, membuat animasi berbasis keyframe, lalu mengekspor hasilnya sebagai project JSON, paket Spine-like, atau video WebM.

README ini ditulis sebagai panduan penggunaan aplikasi secara praktis, supaya orang yang baru membuka project ini bisa langsung memahami semua fitur yang memang sudah ada di aplikasi.

## Fitur Utama

- Membuat bone baru langsung dari canvas
- Menyusun parent-child hierarchy antar bone
- Drag and drop urutan bone di panel Bones
- Mengedit properti bone: nama, posisi, panjang, rotasi, scale, dan parent
- Menambahkan slot pada bone terpilih
- Mengunggah attachment gambar per slot
- Mengatur attachment aktif pada slot
- Mengelola skin aktif
- Menampilkan atau menyembunyikan bone indicators
- Menambahkan background image sebagai referensi
- Mode `SETUP` dan `ANIMATE`
- Timeline dengan scrub frame, playback, prev/next key, stop, FPS, dan duration
- Insert, clear, delete, dan looping keyframe
- Undo/redo
- Save/load project JSON
- Export Spine-like ZIP
- Export video WebM
- Desktop menu untuk aksi file dan view

## Tech Stack

- React 19
- TypeScript
- Zustand
- Vite
- Tailwind CSS 4
- Tauri 2 untuk build desktop

## Kebutuhan

### Web

- Bun direkomendasikan
- Browser modern dengan dukungan Canvas API, File API, dan `MediaRecorder`

### Desktop

- Bun
- Rust toolchain
- Dependensi Tauri yang sesuai OS

## Instalasi

Menggunakan Bun:

```bash
bun install
```

Alternatif npm:

```bash
npm install
```

## Menjalankan Aplikasi

### Development Web

```bash
bun run dev
```

### Build Web

```bash
bun run build
```

### Preview Web Build

```bash
bun run preview
```

### Development Desktop

```bash
bun run tauri:dev
```

### Build Desktop

```bash
bun run tauri:build
```

### Build DMG macOS

```bash
bun run tauri:build -- --bundles dmg
```

## Struktur Antarmuka

Saat aplikasi dibuka dan project masih kosong, aplikasi akan memuat demo skeleton secara otomatis agar user langsung punya contoh rig yang bisa dieksplorasi.

### 1. Toolbar Atas

Toolbar berisi:

- Tool selection: `Pose`, `Bone`, `Move`, `Rotate`, `Scale`
- `Undo` dan `Redo`
- `Key` untuk insert keyframe
- `Clear` untuk menghapus semua keyframe pada bone terpilih
- `Loop` untuk membuat loop dari keyframe yang ada
- `1st Key` untuk menyalin keyframe pertama ke frame saat ini
- `Save`, `Load`, `Export Spine`, `Export Video` pada mode web/non-desktop
- `Background` untuk upload gambar referensi
- `Remove BG` untuk menghapus background
- Toggle mode `SETUP` dan `ANIMATE`

### 2. Panel Kiri

Panel kiri terdiri dari:

- `Bones`
- `Slots`
- `Skins`

Fungsi panel kiri:

- memilih bone
- menyusun urutan bone
- mengelola slot dan attachment
- mengganti skin aktif

### 3. Canvas Tengah

Canvas adalah area kerja utama untuk:

- membuat bone
- memilih bone
- menggeser posisi bone
- memutar bone
- mengubah scale bone
- melihat attachment yang dipasang
- melihat background referensi
- pan dan zoom kamera

### 4. Panel Kanan

Panel kanan menampilkan:

- properti attachment aktif pada slot terpilih
- properti bone terpilih

Kalau tidak ada bone yang dipilih, panel ini akan menampilkan pesan bantuan.

### 5. Timeline Bawah

Timeline digunakan untuk:

- scrub frame
- playback animasi
- berpindah ke keyframe sebelumnya atau berikutnya
- stop dan kembali ke frame 0
- edit FPS
- edit duration
- memilih baris bone dari timeline
- menghapus keyframe dengan double click, klik kanan, atau tombol keyboard

### 6. Status Bar

Status bar di bawah menampilkan:

- nama aplikasi
- nama file project yang sedang dibuka
- tombol `Open File` pada desktop app
- shortcut penting seperti delete, keyframe, play/pause, setup/animate, dan tool shortcuts

## Panduan Pemakaian Lengkap

## 1. Membuat Bone

Cara membuat bone:

1. Pilih tool `Bone`.
2. Klik di canvas untuk membuat bone baru.
3. Jika kamu klik di atas bone yang sudah ada saat membuat bone baru, bone baru akan memakai bone tersebut sebagai parent.

Perilaku bone baru:

- nama default: `bone_{index}`
- panjang default: `50`
- `scaleX` dan `scaleY` default: `1`
- skin bone baru mengikuti skin yang sedang aktif

Catatan:

- bone bisa dipilih dari canvas atau dari panel `Bones`
- urutan bone di panel `Bones` bisa diubah dengan drag and drop
- menghapus bone parent juga akan menghapus child bone yang terhubung langsung ke parent itu

## 2. Memilih dan Memanipulasi Bone

### Pose Tool

Gunakan `Pose` untuk seleksi dan manipulasi umum.

Di canvas:

- klik bone untuk memilih
- klik area kosong untuk clear selection
- drag bone terpilih untuk menggeser

### Move Tool

Gunakan `Move` untuk memindahkan bone secara eksplisit.

Perilaku:

- klik bone untuk memilih
- drag untuk mengubah posisi
- jika bone punya parent, posisi lokal akan dihitung ulang terhadap parent itu

### Rotate Tool

Gunakan `Rotate` untuk memutar bone dari pivot bone tersebut.

Perilaku:

- klik bone
- drag melingkar di sekitar titik bone
- rotasi akan diubah berdasarkan sudut pointer terhadap posisi bone

### Scale Tool

Gunakan `Scale` untuk mengubah `scaleX` dan `scaleY` bone secara bersamaan.

Perilaku:

- klik bone
- drag menjauh atau mendekat dari pivot
- faktor scale dihitung dari rasio jarak pointer

## 3. Mengedit Bone dari Properties Panel

Saat bone dipilih, panel `Properties` menyediakan field berikut:

- `Name`
- `X`
- `Y`
- `Length`
- `Rotation`
- `Scale X`
- `Scale Y`
- `Parent`

Catatan penting:

- jika mode saat ini `ANIMATE`, perubahan numerik seperti posisi, rotasi, dan scale akan otomatis menulis keyframe untuk bone aktif
- mengganti `Parent` menjaga world transform bone tetap konsisten, sehingga bone tidak “loncat” sembarangan saat reparent

## 4. Mengelola Slots dan Attachments

### Menambahkan Slot

1. Pilih bone.
2. Di panel `Slots`, klik tombol `+`.
3. Slot baru akan dibuat dengan nama default berbasis nama bone.

### Upload Gambar ke Slot

1. Klik tombol upload pada slot.
2. Pilih file gambar.
3. Aplikasi otomatis membuat attachment image untuk slot itu.
4. Attachment tersebut langsung dijadikan attachment aktif.

Format gambar yang diterima:

- PNG
- JPG / JPEG
- WEBP
- GIF
- SVG

Saat gambar dimuat:

- ukuran asli gambar dibaca
- aplikasi otomatis memberi scale awal agar ukuran visual lebih pas di scene

### Memilih Attachment Aktif

Jika satu slot punya lebih dari satu attachment, semua attachment akan tampil sebagai daftar tombol di bawah slot. Klik salah satu nama attachment untuk menjadikannya aktif.

### Menghapus Slot

Klik ikon trash pada slot untuk menghapus slot tersebut.

## 5. Mengatur Attachment dari Panel Kanan

Jika slot aktif memiliki attachment image, panel kanan akan menampilkan properti attachment seperti:

- posisi offset
- rotasi
- scale

Panel ini dipakai untuk menyelaraskan gambar dengan bone, misalnya:

- menaikkan gambar agar tepat di atas tulang
- memutar gambar supaya searah dengan bone
- membesarkan atau mengecilkan gambar tanpa mengubah data bone

## 6. Mengelola Skins

Panel `Skins` menampilkan daftar semua skin.

Yang bisa dilakukan:

- klik skin untuk menjadikannya skin aktif
- semua bone baru akan menggunakan skin aktif tersebut
- warna skin dipakai sebagai warna dasar indikator bone di canvas

## 7. Background Reference

Toolbar menyediakan dua aksi:

- `Background`
- `Remove BG`

Fungsinya:

- upload gambar referensi untuk tracing atau sebagai acuan pose
- hapus background jika tidak diperlukan lagi

Perilaku background:

- background dirender semi-transparan
- tetap tampil di canvas sebagai referensi visual
- dapat ikut muncul saat export video

## 8. Bone Indicators

Bone indicators adalah lingkaran dan label visual pada bone di canvas.

Perilaku:

- bisa di-hide/show
- saat disembunyikan, bone tetap bisa di-hit-test dan diedit
- jadi toggle ini hanya menyembunyikan indikator visual, bukan mematikan sistem bone

### Desktop Menu

Di desktop app, toggle ini ada di:

- `View > Toggle Bone Indicators`

Shortcut desktop:

- `Cmd/Ctrl + B`

## 9. Mode SETUP dan ANIMATE

### SETUP

Mode ini dipakai untuk menyiapkan rig dasar:

- mengatur pose dasar
- menyusun parent
- menyesuaikan attachment

Saat masuk `SETUP`:

- aplikasi me-restore setup pose yang tersimpan

### ANIMATE

Mode ini dipakai untuk membuat animasi frame-by-frame berbasis keyframe.

Saat pindah ke `ANIMATE`:

- aplikasi membandingkan pose sekarang dengan setup pose lama
- jika ada delta posisi, rotasi, atau scale, keyframe yang ada akan di-shift agar tetap sinkron dengan setup pose baru
- setup pose baru kemudian disimpan

Ini penting karena memungkinkan kamu memperbaiki rig setup tanpa langsung merusak keyframe animasi yang sudah ada.

## 10. Timeline dan Animasi

### Memilih Frame

Cara memilih frame:

- klik area timeline
- drag pada area timeline untuk scrub frame
- pakai `Arrow Left` dan `Arrow Right`

Saat mode `ANIMATE`, perubahan frame akan menerapkan keyframe ke skeleton.

### Playback

Kontrol timeline:

- `Play/Pause`
- `Stop`
- `Prev Key`
- `Next Key`

Perilaku playback:

- playback memakai `fps` yang sedang aktif
- timeline akan loop otomatis ke frame `0` setelah keyframe terakhir global tercapai

### Edit FPS dan Duration

Field di timeline:

- `FPS` bisa diatur dari `1` sampai `120`
- `Duration` bisa diatur dari `10` sampai `300`

### Interaksi Keyframe

Yang bisa dilakukan:

- `K` atau tombol `Key`: insert keyframe pada frame aktif
- `Clear`: hapus semua keyframe pada bone terpilih
- `Loop`: mirror keyframes untuk membantu membuat loop
- `1st Key`: copy keyframe pertama bone aktif ke frame saat ini
- double click keyframe: hapus keyframe itu
- hover keyframe lalu tekan `X` atau `Delete`: hapus keyframe
- klik kanan pada keyframe: hapus keyframe

Properti yang di-keyframe:

- `x`
- `y`
- `rotation`
- `scaleX`
- `scaleY`

Interpolasi yang dipakai saat playback:

- linear interpolation

## 11. Save, Load, dan Project File

### Save Project

Save akan menulis project JSON yang berisi:

- bones
- skins
- active skin
- setup pose
- slots
- attachments
- keyframes
- duration
- fps
- background image

Nama file saran default:

- `spinebones-project.json`

### Load Project

Load membaca file project JSON yang sebelumnya disimpan dari aplikasi ini.

Saat project dimuat:

- state editor diganti ke isi file
- frame di-reset ke `0`
- playback dimatikan
- selection dibersihkan
- setup pose dipastikan valid
- bones di-restore ke setup pose agar tampilan awal benar

### Desktop File Menu

Pada desktop app tersedia menu:

- `File > Save`
- `File > Save As…`
- `File > Open…`
- `File > Export Spine`
- `File > Export Video`

## 12. Export

### Export Spine

Export Spine membuat file ZIP berisi:

- `skeleton.json`
- `atlas.atlas`
- file PNG untuk setiap attachment

Cocok untuk workflow ringan yang butuh output mirip format Spine.

### Export Video

Export video menghasilkan file:

- `*.webm`

Video export:

- merender animation frame-by-frame
- memakai `MediaRecorder`
- bisa memasukkan background image kalau sedang aktif

## Shortcut Lengkap

### Tools dan Mode

- `Q`: Pose
- `B`: Bone
- `M`: Move
- `R`: Rotate
- `S`: Scale
- `W`: pindah ke `SETUP`
- `E`: pindah ke `ANIMATE`

### Editing

- `K`: insert keyframe
- `Delete` / `Backspace`: delete bone terpilih
- `Esc`: clear selection

### Timeline

- `Space`: play/pause
- `Arrow Left`: frame mundur
- `Arrow Right`: frame maju
- double click keyframe: delete keyframe
- `X` atau `Delete` saat hover keyframe: delete keyframe

### Undo / Redo / File

- `Cmd/Ctrl + Z`: undo
- `Cmd/Ctrl + Shift + Z`: redo
- `Cmd/Ctrl + Y`: redo
- `Cmd/Ctrl + S`: save
- `Cmd/Ctrl + Shift + S`: save as
- `Cmd/Ctrl + O`: open

### Navigasi Canvas

- `Right Mouse Button` drag: pan
- scroll wheel: zoom

### Desktop View Menu

- `Cmd/Ctrl + B`: toggle bone indicators

## Tips Penggunaan

- Mulailah di mode `SETUP` untuk membangun struktur rig
- Setelah pose dasar benar, pindah ke `ANIMATE`
- Gunakan panel `Properties` jika butuh nilai numerik presisi
- Gunakan skin aktif sebelum membuat bone baru jika kamu ingin warna bone berbeda
- Gunakan background image sebagai panduan tracing pose
- Jika animasi terasa sulit diatur, insert keyframe lebih sering pada pose penting

## Catatan Perilaku Penting

- State aplikasi bersifat in-memory selama sesi berjalan
- Project harus disimpan manual jika ingin dipakai lagi
- Demo skeleton dimuat otomatis saat state masih kosong
- Menghapus bone parent juga akan menghapus child bone yang bergantung padanya
- Menyembunyikan bone indicators tidak menonaktifkan bone editing

## Script yang Tersedia

```json
{
  "dev": "vite",
  "build": "tsc -b && vite build",
  "tauri:dev": "tauri dev",
  "tauri:build": "tauri build",
  "lint": "eslint .",
  "preview": "bun run build && wrangler dev",
  "deploy": "bun run build && wrangler deploy"
}
```

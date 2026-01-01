# Task Tracker - Web Minimalist untuk Task Management

Aplikasi web sederhana untuk mengelola task dengan fitur:
- ✅ Todo List
- 📌 Kanban Board
- ⏱️ Time Tracking
- 📊 Dashboard Reporting
- 💾 SQLite Database

## Instalasi

1. Install dependencies:
```bash
pip install -r requirements.txt
```

2. Jalankan aplikasi:
```bash
python app.py
```

3. Buka browser dan akses:
```
http://localhost:5000
```

## Fitur

### Todo List
- Tambah, edit, hapus task
- Status: Todo, In Progress, Done
- Timer untuk tracking waktu
- Deskripsi task

### Kanban Board
- Drag & drop task antar kolom
- 3 kolom: Todo, In Progress, Done
- Visual progress tracking

### Time Tracking
- Start/stop timer untuk setiap task
- Otomatis hitung total waktu
- History time logs

### Dashboard
- Statistik task berdasarkan status
- Total waktu yang dihabiskan
- Task selesai hari ini
- Rata-rata waktu per task

## Teknologi
- Backend: Python Flask
- Database: SQLite
- Frontend: HTML, CSS, JavaScript (Vanilla)

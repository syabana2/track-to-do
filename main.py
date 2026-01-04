import webview
import sys
import os
from app import app, init_db

def get_resource_path(relative_path):
    """ Get absolute path to resource, works for dev and for PyInstaller """
    try:
        # PyInstaller creates a temp folder and stores path in _MEIPASS
        base_path = sys._MEIPASS
    except Exception:
        base_path = os.path.abspath(".")
    return os.path.join(base_path, relative_path)

if __name__ == '__main__':
    # Pastikan database terinisialisasi
    init_db()

    # Membuka jendela aplikasi desktop yang mengarah ke server Flask
    # pywebview bisa langsung menjalankan app Flask
    webview.create_window('Second Brain - Tracking System', app, width=1280, height=800)
    webview.start()

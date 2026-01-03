from flask import Flask, render_template, request, jsonify
from datetime import datetime
import sqlite3
import os

app = Flask(__name__)
DATABASE = 'tracking.db'

def get_db():
    conn = sqlite3.connect(DATABASE)
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    conn = get_db()
    cursor = conn.cursor()

    cursor.execute('''
        CREATE TABLE IF NOT EXISTS tasks (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT NOT NULL,
            description TEXT,
            status TEXT DEFAULT 'todo',
            priority TEXT DEFAULT 'medium',
            project TEXT,
            due_date DATE,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            started_at TIMESTAMP,
            completed_at TIMESTAMP,
            time_spent INTEGER DEFAULT 0
        )
    ''')

    cursor.execute('''
        CREATE TABLE IF NOT EXISTS time_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            task_id INTEGER,
            start_time TIMESTAMP,
            end_time TIMESTAMP,
            duration INTEGER,
            FOREIGN KEY (task_id) REFERENCES tasks (id)
        )
    ''')

    cursor.execute('''
        CREATE TABLE IF NOT EXISTS server_credentials (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT NOT NULL,
            project TEXT,
            ip TEXT NOT NULL,
            password TEXT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    ''')

    conn.commit()
    conn.close()

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/api/tasks', methods=['GET'])
def get_tasks():
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute('SELECT * FROM tasks ORDER BY created_at DESC')
    tasks = [dict(row) for row in cursor.fetchall()]
    conn.close()
    return jsonify(tasks)

@app.route('/api/projects', methods=['GET'])
def get_projects():
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute('SELECT DISTINCT project FROM tasks WHERE project IS NOT NULL AND project != "" ORDER BY project')
    projects = [row['project'] for row in cursor.fetchall()]
    conn.close()
    return jsonify(projects)

@app.route('/api/tasks', methods=['POST'])
def create_task():
    data = request.json
    conn = get_db()
    cursor = conn.cursor()

    created_at = data.get('created_at') if data.get('created_at') else None

    if created_at:
        cursor.execute(
            'INSERT INTO tasks (title, description, status, priority, project, due_date, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
            (data['title'], data.get('description', ''), data.get('status', 'todo'),
             data.get('priority', 'medium'), data.get('project', ''), data.get('due_date'), created_at)
        )
    else:
        cursor.execute(
            'INSERT INTO tasks (title, description, status, priority, project, due_date) VALUES (?, ?, ?, ?, ?, ?)',
            (data['title'], data.get('description', ''), data.get('status', 'todo'),
             data.get('priority', 'medium'), data.get('project', ''), data.get('due_date'))
        )

    conn.commit()
    task_id = cursor.lastrowid
    conn.close()
    return jsonify({'id': task_id, 'message': 'Task created'}), 201

@app.route('/api/tasks/<int:task_id>', methods=['PUT'])
def update_task(task_id):
    data = request.json
    conn = get_db()
    cursor = conn.cursor()

    # Update task including created_at
    cursor.execute(
        'UPDATE tasks SET title=?, description=?, status=?, priority=?, project=?, due_date=?, created_at=? WHERE id=?',
        (data['title'], data.get('description', ''), data['status'],
         data.get('priority', 'medium'), data.get('project', ''), data.get('due_date'),
         data.get('created_at'), task_id)
    )

    # Update timestamps based on status change
    if data['status'] == 'in-progress':
        cursor.execute('UPDATE tasks SET started_at=CURRENT_TIMESTAMP WHERE id=? AND started_at IS NULL', (task_id,))
    elif data['status'] == 'done':
        cursor.execute('UPDATE tasks SET completed_at=CURRENT_TIMESTAMP WHERE id=? AND completed_at IS NULL', (task_id,))

    conn.commit()
    conn.close()
    return jsonify({'message': 'Task updated'})

@app.route('/api/tasks/<int:task_id>', methods=['DELETE'])
def delete_task(task_id):
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute('DELETE FROM time_logs WHERE task_id=?', (task_id,))
    cursor.execute('DELETE FROM tasks WHERE id=?', (task_id,))
    conn.commit()
    conn.close()
    return jsonify({'message': 'Task deleted'})

@app.route('/api/tasks/<int:task_id>/start-timer', methods=['POST'])
def start_timer(task_id):
    conn = get_db()
    cursor = conn.cursor()

    # Stop all other active timers first
    cursor.execute(
        'SELECT DISTINCT task_id FROM time_logs WHERE end_time IS NULL'
    )
    active_tasks = cursor.fetchall()

    for task in active_tasks:
        other_task_id = task['task_id']
        if other_task_id != task_id:
            # Stop the timer
            cursor.execute(
                'SELECT id, start_time FROM time_logs WHERE task_id=? AND end_time IS NULL ORDER BY start_time DESC LIMIT 1',
                (other_task_id,)
            )
            log = cursor.fetchone()

            if log:
                cursor.execute(
                    'UPDATE time_logs SET end_time=CURRENT_TIMESTAMP, duration=(strftime("%s", CURRENT_TIMESTAMP) - strftime("%s", start_time)) WHERE id=?',
                    (log['id'],)
                )

                # Update total time spent on that task
                cursor.execute(
                    'UPDATE tasks SET time_spent = (SELECT COALESCE(SUM(duration), 0) FROM time_logs WHERE task_id=?) WHERE id=?',
                    (other_task_id, other_task_id)
                )

    # Start new timer
    cursor.execute(
        'INSERT INTO time_logs (task_id, start_time) VALUES (?, CURRENT_TIMESTAMP)',
        (task_id,)
    )
    conn.commit()
    log_id = cursor.lastrowid
    conn.close()
    return jsonify({'log_id': log_id, 'message': 'Timer started'})

@app.route('/api/tasks/<int:task_id>/stop-timer', methods=['POST'])
def stop_timer(task_id):
    conn = get_db()
    cursor = conn.cursor()

    # Get the latest active time log
    cursor.execute(
        'SELECT id, start_time FROM time_logs WHERE task_id=? AND end_time IS NULL ORDER BY start_time DESC LIMIT 1',
        (task_id,)
    )
    log = cursor.fetchone()

    if log:
        cursor.execute(
            'UPDATE time_logs SET end_time=CURRENT_TIMESTAMP, duration=(strftime("%s", CURRENT_TIMESTAMP) - strftime("%s", start_time)) WHERE id=?',
            (log['id'],)
        )

        # Update total time spent on task
        cursor.execute(
            'UPDATE tasks SET time_spent = (SELECT COALESCE(SUM(duration), 0) FROM time_logs WHERE task_id=?) WHERE id=?',
            (task_id, task_id)
        )

        conn.commit()
        conn.close()
        return jsonify({'message': 'Timer stopped'})

    conn.close()
    return jsonify({'message': 'No active timer found'}), 404

@app.route('/api/dashboard/stats', methods=['GET'])
def get_dashboard_stats():
    conn = get_db()
    cursor = conn.cursor()

    # Get task counts by status
    cursor.execute('SELECT status, COUNT(*) as count FROM tasks GROUP BY status')
    status_counts = {row['status']: row['count'] for row in cursor.fetchall()}

    # Get total time spent
    cursor.execute('SELECT COALESCE(SUM(time_spent), 0) as total_time FROM tasks')
    total_time = cursor.fetchone()['total_time']

    # Get tasks completed today
    cursor.execute('SELECT COUNT(*) as count FROM tasks WHERE DATE(completed_at) = DATE("now")')
    completed_today = cursor.fetchone()['count']

    # Get average time per task
    cursor.execute('SELECT AVG(time_spent) as avg_time FROM tasks WHERE time_spent > 0')
    avg_time = cursor.fetchone()['avg_time'] or 0

    # Get tasks completed per day grouped by priority (last 7 days)
    cursor.execute('''
        SELECT
            DATE(completed_at) as date,
            priority,
            COUNT(*) as count
        FROM tasks
        WHERE completed_at IS NOT NULL
        AND DATE(completed_at) >= DATE('now', '-6 days')
        GROUP BY DATE(completed_at), priority
        ORDER BY DATE(completed_at)
    ''')
    daily_completion = cursor.fetchall()

    # Get tasks created per day grouped by priority (last 7 days)
    cursor.execute('''
        SELECT
            DATE(created_at) as date,
            priority,
            COUNT(*) as count
        FROM tasks
        WHERE DATE(created_at) >= DATE('now', '-6 days')
        GROUP BY DATE(created_at), priority
        ORDER BY DATE(created_at)
    ''')
    daily_created = cursor.fetchall()

    conn.close()

    return jsonify({
        'status_counts': status_counts,
        'total_time': total_time,
        'completed_today': completed_today,
        'average_time': avg_time,
        'daily_completion': [dict(row) for row in daily_completion],
        'daily_created': [dict(row) for row in daily_created]
    })

@app.route('/api/credentials', methods=['GET'])
def get_credentials():
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute('SELECT * FROM server_credentials ORDER BY created_at DESC')
    credentials = [dict(row) for row in cursor.fetchall()]
    conn.close()
    return jsonify(credentials)

@app.route('/api/credentials', methods=['POST'])
def create_credential():
    data = request.json
    conn = get_db()
    cursor = conn.cursor()

    cursor.execute(
        'INSERT INTO server_credentials (title, project, ip, password) VALUES (?, ?, ?, ?)',
        (data['title'], data.get('project', ''), data['ip'], data['password'])
    )

    conn.commit()
    credential_id = cursor.lastrowid
    conn.close()
    return jsonify({'id': credential_id, 'message': 'Credential created'}), 201

@app.route('/api/credentials/<int:credential_id>', methods=['PUT'])
def update_credential(credential_id):
    data = request.json
    conn = get_db()
    cursor = conn.cursor()

    cursor.execute(
        'UPDATE server_credentials SET title=?, project=?, ip=?, password=?, updated_at=CURRENT_TIMESTAMP WHERE id=?',
        (data['title'], data.get('project', ''), data['ip'], data['password'], credential_id)
    )

    conn.commit()
    conn.close()
    return jsonify({'message': 'Credential updated'})

@app.route('/api/credentials/<int:credential_id>', methods=['DELETE'])
def delete_credential(credential_id):
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute('DELETE FROM server_credentials WHERE id=?', (credential_id,))
    conn.commit()
    conn.close()
    return jsonify({'message': 'Credential deleted'})

@app.route('/api/tasks/active-timers', methods=['GET'])
def get_active_timers():
    conn = get_db()
    cursor = conn.cursor()
    
    # Get all tasks with active timers
    cursor.execute('''
        SELECT t.id, t.time_spent, tl.start_time,
               (strftime('%s', 'now') - strftime('%s', tl.start_time)) as elapsed
        FROM tasks t
        JOIN time_logs tl ON t.id = tl.task_id
        WHERE tl.end_time IS NULL
        ORDER BY tl.start_time DESC
    ''')
    
    active_timers = [dict(row) for row in cursor.fetchall()]
    conn.close()
    return jsonify(active_timers)

if __name__ == '__main__':
    init_db()
    app.run(debug=True, port=5000)

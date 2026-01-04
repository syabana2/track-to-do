let tasks = [];
let activeTimers = {};
let timerStartTimes = {}; // Store when each timer was started
let tasksCreatedChart = null;
let tasksCompletedChart = null;
let credentials = [];

// Configure marked.js for better markdown rendering
if (typeof marked !== 'undefined') {
    marked.setOptions({
        breaks: true,
        gfm: true,
        headerIds: true,
        mangle: false,
        sanitize: false,
        highlight: function(code, lang) {
            if (lang && hljs.getLanguage(lang)) {
                try {
                    return hljs.highlight(code, { language: lang }).value;
                } catch (err) {
                    console.error('Highlight error:', err);
                }
            }
            return hljs.highlightAuto(code).value;
        }
    });

    // Custom renderer for proper task lists styling
    const renderer = new marked.Renderer();

    renderer.listitem = function(text, task, checked) {
        if (task) {
            // Remove any existing checkbox from text to prevent duplication
            let cleanText = text.replace(/<input[^>]*>/gi, '');
            return `<li class="task-list-item"><input type="checkbox" ${checked ? 'checked' : ''} disabled> ${cleanText}</li>\n`;
        }
        return `<li>${text}</li>\n`;
    };

    renderer.list = function(body, ordered, start) {
        const type = ordered ? 'ol' : 'ul';
        const startAttr = (ordered && start !== 1) ? ` start="${start}"` : '';
        return `<${type}${startAttr}>\n${body}</${type}>\n`;
    };

    marked.use({ renderer });
}

// Initialize app
document.addEventListener('DOMContentLoaded', async () => {
    initDefaultFilters();
    await loadTasks();
    await restoreActiveTimers();
    loadDashboard();
});

// View management
function showView(viewName) {
    document.querySelectorAll('.view').forEach(view => view.style.display = 'none');
    document.querySelectorAll('.nav-btn').forEach(btn => btn.classList.remove('active'));

    document.getElementById(`${viewName}-view`).style.display = 'block';
    if (window.event) {
        window.event.target.classList.add('active');
    } else {
        // Fallback for when called programmatically or if event is missing
        const btn = document.querySelector(`button[onclick="showView('${viewName}')"]`);
        if (btn) btn.classList.add('active');
    }

    // Hide/show global filters based on view
    const filtersContainer = document.querySelector('.filters-container');
    if (viewName === 'notes' || viewName === 'credentials') {
        filtersContainer.style.display = 'none';
    } else {
        filtersContainer.style.display = 'grid';
    }

    // Hide search filter specifically for Dashboard
    const searchFilterInput = document.getElementById('filter-search');
    if (searchFilterInput) {
        const searchGroup = searchFilterInput.closest('.filter-group');
        if (searchGroup) {
            searchGroup.style.display = viewName === 'dashboard' ? 'none' : 'block';
        }
    }

    if (viewName === 'dashboard') {
        loadDashboard();
    } else if (viewName === 'kanban') {
        renderKanban();
    } else if (viewName === 'todo') {
        renderTodoList();
    } else if (viewName === 'credentials') {
        loadCredentials();
    } else if (viewName === 'notes') {
        loadFolders();
        loadNotes();
    }
}

// Load tasks from API
async function loadTasks() {
    try {
        const response = await fetch('/api/tasks');
        tasks = await response.json();
        await loadProjects();
        populateProjectFilter();
        renderTodoList();
        renderKanban();
    } catch (error) {
        console.error('Error loading tasks:', error);
    }
}

// Restore active timers after page refresh
async function restoreActiveTimers() {
    try {
        const response = await fetch('/api/tasks/active-timers');
        const activeTimersList = await response.json();

        // Restore each active timer
        for (const timerInfo of activeTimersList) {
            const taskId = timerInfo.id;

            // Store the start time for this timer session
            timerStartTimes[taskId] = {
                startTime: new Date(timerInfo.start_time.replace(' ', 'T')),
                baseTimeSpent: timerInfo.time_spent || 0
            };

            // Update the task's display immediately
            const task = tasks.find(t => t.id === taskId);
            if (task) {
                const now = new Date();
                const elapsed = Math.floor((now - timerStartTimes[taskId].startTime) / 1000);
                task.time_spent = timerStartTimes[taskId].baseTimeSpent + elapsed;

                // Start the interval timer to continue counting
                activeTimers[taskId] = setInterval(() => {
                    updateTaskTimer(taskId);
                }, 1000);
            }
        }

        // Re-render to show timer buttons correctly
        if (activeTimersList.length > 0) {
            renderTodoList();
            renderKanban();
        }
    } catch (error) {
        console.error('Error restoring active timers:', error);
    }
}

// Load projects for autocomplete
async function loadProjects() {
    try {
        const response = await fetch('/api/projects');
        const projects = await response.json();

        const datalist = document.getElementById('project-list');
        if (datalist) {
            datalist.innerHTML = '';
            projects.forEach(project => {
                const option = document.createElement('option');
                option.value = project;
                datalist.appendChild(option);
            });
        }
    } catch (error) {
        console.error('Error loading projects:', error);
    }
}

// Render Todo List
function renderTodoList() {
    const todoList = document.getElementById('todo-list');
    todoList.innerHTML = '';

    // Apply filters
    let filteredTasks = getFilteredTasks();

    if (filteredTasks.length === 0) {
        todoList.innerHTML = '<p style="text-align: center; color: var(--text-secondary); padding: 40px;">No tasks found.</p>';
        return;
    }

    // Group tasks by date
    const groupedTasks = groupTasksByDate(filteredTasks);

    // Render each date group
    Object.keys(groupedTasks).sort((a, b) => {
        if (a === 'No Due Date') return 1;
        if (b === 'No Due Date') return -1;
        if (a === '🔴 Overdue') return -1;
        if (b === '🔴 Overdue') return 1;
        if (a === '📅 Today') return -1;
        if (b === '📅 Today') return 1;
        if (a === '📅 Tomorrow') return -1;
        if (b === '📅 Tomorrow') return 1;
        return new Date(a) - new Date(b);
    }).forEach(dateKey => {
        const dateGroup = document.createElement('div');
        dateGroup.className = 'date-group';

        const dateHeader = document.createElement('div');
        dateHeader.className = 'date-header';
        dateHeader.textContent = `${dateKey} (${groupedTasks[dateKey].length})`;
        dateGroup.appendChild(dateHeader);

        // Sort tasks by priority within each date group (high -> medium -> low)
        const priorityOrder = { 'high': 1, 'medium': 2, 'low': 3 };
        groupedTasks[dateKey].sort((a, b) => {
            return priorityOrder[a.priority || 'medium'] - priorityOrder[b.priority || 'medium'];
        }).forEach(task => {
            const taskEl = createTaskElement(task);
            dateGroup.appendChild(taskEl);
        });

        todoList.appendChild(dateGroup);
    });
}

function groupTasksByDate(tasks) {
    const groups = {};
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    tasks.forEach(task => {
        let dateKey = 'No Due Date';

        if (task.due_date) {
            let dueDate;
            if (/^\d{4}-\d{2}-\d{2}$/.test(task.due_date)) {
                const [y, m, d] = task.due_date.split('-').map(Number);
                dueDate = new Date(y, m - 1, d);
            } else {
                dueDate = new Date(task.due_date);
                dueDate.setHours(0, 0, 0, 0);
            }

            if (task.status !== 'done' && dueDate < today) {
                dateKey = '🔴 Overdue';
            } else if (dueDate.getTime() === today.getTime()) {
                dateKey = '📅 Today';
            } else if (dueDate.getTime() === tomorrow.getTime()) {
                dateKey = '📅 Tomorrow';
            } else {
                // Use formatted date for display (e.g., "Sun, Jan 4")
                dateKey = formatDate(task.due_date);
            }
        }

        if (!groups[dateKey]) {
            groups[dateKey] = [];
        }
        groups[dateKey].push(task);
    });

    return groups;
}

function createTaskElement(task) {
    const taskEl = document.createElement('div');
    const isOverdue = checkIfOverdue(task);
    taskEl.className = `task-item status-${task.status} priority-${task.priority || 'medium'}${isOverdue ? ' overdue' : ''}`;
    taskEl.dataset.taskId = task.id;

    const timeSpent = formatTime(task.time_spent);
    const isTimerActive = activeTimers[task.id];

    const priorityEmoji = {
        'low': '🟢',
        'medium': '🟡',
        'high': '🔴'
    };

    const overdueBadge = isOverdue ? '<span class="overdue-badge">⚠️ Overdue</span>' : '';

    taskEl.innerHTML = `
        ${overdueBadge}
        <div class="task-header">
            <div class="task-title">${task.title}</div>
            <div class="task-actions">
                <button class="task-btn" onclick="editTask(${task.id})" title="Edit">✏️</button>
                <button class="task-btn" onclick="deleteTask(${task.id})" title="Delete">🗑️</button>
            </div>
        </div>
        ${task.description ? `<div class="task-description">${task.description}</div>` : ''}
        <div class="task-meta">
            <span class="task-status status-${task.status}">${getStatusLabel(task.status)}</span>
            <span class="priority-badge priority-${task.priority || 'medium'}">${priorityEmoji[task.priority || 'medium']} ${capitalizeFirst(task.priority || 'medium')}</span>
            ${task.project ? `<span class="task-project">📁 ${task.project}</span>` : ''}
            <span class="task-time-display">⏱️ ${timeSpent} <button class="edit-time-btn" onclick="editTimeSpent(${task.id}, event)" title="Edit Time">✏️</button></span>
        </div>
        <div class="task-dates">
            ${task.created_at ? `<span class="task-date-item">📅 Created: ${formatDateShort(task.created_at)}</span>` : ''}
            ${task.due_date ? `<span class="task-date-item" ${isOverdue ? 'style="color: var(--danger); font-weight: 600;"' : ''}>⏰ Due: ${formatDateShort(task.due_date)}</span>` : ''}
        </div>
        <div class="timer-controls">
            ${!isTimerActive ?
                `<button class="timer-btn timer-start" onclick="startTimer(${task.id})">▶️ Start Timer</button>` :
                `<button class="timer-btn timer-stop" onclick="stopTimer(${task.id})">⏹️ Stop Timer</button>`
            }
        </div>
    `;

    return taskEl;
}

// Render Kanban Board
function renderKanban() {
    const columns = {
        'todo': document.getElementById('kanban-todo'),
        'in-progress': document.getElementById('kanban-in-progress'),
        'done': document.getElementById('kanban-done')
    };

    Object.values(columns).forEach(col => col.innerHTML = '');

    // Apply filters
    const filteredTasks = getFilteredTasks();

    filteredTasks.forEach(task => {
        const card = document.createElement('div');
        const isOverdue = checkIfOverdue(task);
        card.className = `kanban-card priority-${task.priority || 'medium'}${isOverdue ? ' overdue' : ''}`;
        card.draggable = true;
        card.dataset.taskId = task.id;

        const priorityEmoji = {
            'low': '🟢',
            'medium': '🟡',
            'high': '🔴'
        };

        const isTimerActive = activeTimers[task.id];

        card.innerHTML = `
            <div class="kanban-card-title">${task.title}</div>
            <div class="kanban-card-meta">
                <div class="kanban-card-row">
                    <span>${priorityEmoji[task.priority || 'medium']} ${capitalizeFirst(task.priority || 'medium')}</span>
                    ${isOverdue ? '<span class="kanban-overdue-badge">⚠️ Overdue</span>' : ''}
                </div>
                ${task.project ? `<div class="kanban-card-project">📁 ${task.project}</div>` : ''}
                <div class="kanban-card-row">
                    ${task.created_at ? `<span>📅 ${formatDateShort(task.created_at)}</span>` : ''}
                    ${task.due_date ? `<span style="${isOverdue ? 'color: var(--danger); font-weight: 600;' : ''}">⏰ ${formatDateShort(task.due_date)}</span>` : ''}
                </div>
            </div>
            <div class="kanban-card-time">⏱️ ${formatTime(task.time_spent)}</div>
            <div class="kanban-timer-controls">
                ${!isTimerActive ?
                    `<button class="kanban-timer-btn kanban-timer-start" onclick="event.stopPropagation(); startTimer(${task.id})">▶️ Start</button>` :
                    `<button class="kanban-timer-btn kanban-timer-stop" onclick="event.stopPropagation(); stopTimer(${task.id})">⏹️ Stop</button>`
                }
            </div>
        `;

        card.addEventListener('dragstart', handleDragStart);
        card.addEventListener('click', () => editTask(task.id));

        columns[task.status].appendChild(card);
    });

    // Setup drop zones
    Object.entries(columns).forEach(([status, column]) => {
        column.addEventListener('dragover', handleDragOver);
        column.addEventListener('drop', (e) => handleDrop(e, status));
    });
}

// Drag and Drop handlers
let draggedTaskId = null;

function handleDragStart(e) {
    draggedTaskId = e.target.dataset.taskId;
    e.target.style.opacity = '0.4';
}

function handleDragOver(e) {
    e.preventDefault();
    return false;
}

async function handleDrop(e, newStatus) {
    e.stopPropagation();
    e.preventDefault();

    if (!draggedTaskId) return;

    const task = tasks.find(t => t.id == draggedTaskId);
    if (task && task.status !== newStatus) {
        task.status = newStatus;
        await updateTaskStatus(task.id, newStatus);
    }

    document.querySelector(`[data-task-id="${draggedTaskId}"]`).style.opacity = '1';
    draggedTaskId = null;

    return false;
}

// Load Dashboard stats
async function loadDashboard() {
    try {
        // Still fetch basic stats for the summary cards if needed, or calculate everything client-side
        // For summary cards, we want to respect the filters too.
        
        const filteredTasks = getFilteredTasks(); // Project/Priority/Status filtered (Date IGNORED on Dashboard)
        
        // --- Prepare Tasks for Summary Cards (Apply Date Filter based on Created At) ---
        let cardTasks = filteredTasks;
        const dateFrom = document.getElementById('filter-date-from')?.value;
        const dateTo = document.getElementById('filter-date-to')?.value;

        if (dateFrom || dateTo) {
            cardTasks = cardTasks.filter(task => {
                const createdDate = task.created_at ? task.created_at.split(' ')[0] : '';
                
                if (dateFrom && (!createdDate || createdDate < dateFrom)) return false;
                if (dateTo && (!createdDate || createdDate > dateTo)) return false;
                
                return true;
            });
        }
        
        // Calculate Summary Stats from cardTasks
        const statusCounts = {
            'todo': cardTasks.filter(t => t.status === 'todo').length,
            'in-progress': cardTasks.filter(t => t.status === 'in-progress').length,
            'done': cardTasks.filter(t => t.status === 'done').length
        };

        const totalTime = cardTasks.reduce((sum, t) => sum + (t.time_spent || 0), 0);
        const tasksWithTime = cardTasks.filter(t => t.time_spent > 0);
        const avgTime = tasksWithTime.length > 0
            ? tasksWithTime.reduce((sum, t) => sum + t.time_spent, 0) / tasksWithTime.length
            : 0;

        // For "Completed Today", it's a specific daily stat, usually unrelated to Due Date filter, 
        // but for consistency with "Filtered Dashboard", maybe we keep it as "from the filtered set"?
        // Actually "Completed Today" is a hardcoded "Today". 
        // Let's use cardTasks to be consistent (e.g. if I filter Project A, I want Completed Today for Project A).
        const today = new Date().toISOString().split('T')[0];
        const completedToday = cardTasks.filter(t =>
            t.completed_at && t.completed_at.startsWith(today)
        ).length;

        // Update Summary Cards
        document.getElementById('stat-todo').textContent = statusCounts.todo;
        document.getElementById('stat-in-progress').textContent = statusCounts['in-progress'];
        document.getElementById('stat-done').textContent = statusCounts.done;
        document.getElementById('stat-completed-today').textContent = completedToday;
        document.getElementById('stat-total-time').textContent = formatTime(totalTime);
        document.getElementById('stat-avg-time').textContent = formatTime(Math.round(avgTime));

        // --- Chart Data Preparation ---
        // Charts use the full filtered list (by Project/Priority) mapped against the selected Date Range
        
        // 1. Determine Date Range
        const dateRange = getDashboardDateRange();
        
        // 2. Calculate Daily Counts from filteredTasks (NOT cardTasks, as we want to show activity over the selected range)
        const dailyCreatedData = calculateDailyCreated(filteredTasks);
        const dailyCompletedData = calculateDailyCompleted(filteredTasks);

        // 3. Render Charts
        renderTasksCreatedChart(dateRange, dailyCreatedData);
        renderTasksCompletedChart(dateRange, dailyCompletedData);

    } catch (error) {
        console.error('Error loading dashboard:', error);
    }
}

function getDashboardDateRange() {
    const dateFrom = document.getElementById('filter-date-from')?.value;
    const dateTo = document.getElementById('filter-date-to')?.value;

    if (dateFrom && dateTo) {
        // Append Time to force Local Time construction
        return getDatesInRange(new Date(dateFrom + 'T00:00:00'), new Date(dateTo + 'T00:00:00'));
    } else if (dateFrom) {
        return getDatesInRange(new Date(dateFrom + 'T00:00:00'), new Date());
    } else if (dateTo) {
        const end = new Date(dateTo + 'T00:00:00');
        const start = new Date(end);
        start.setDate(start.getDate() - 6);
        return getDatesInRange(start, end);
    } else {
        // Default: Last 7 days
        return getLast7Days().reverse(); 
    }
}

function getDatesInRange(startDate, endDate) {
    const dates = [];
    let currentDate = new Date(startDate);
    const end = new Date(endDate);
    
    // Normalize to start of day in Local Time
    currentDate.setHours(0,0,0,0);
    end.setHours(0,0,0,0);

    while (currentDate <= end) {
        dates.push(formatDateToLocalYMD(currentDate));
        currentDate.setDate(currentDate.getDate() + 1);
    }
    return dates;
}

function formatDateToLocalYMD(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function calculateDailyCreated(tasks) {
    // Returns array of { date: 'YYYY-MM-DD', priority: 'high', count: 1 }
    const result = [];
    const counts = {}; // key: date|priority

    tasks.forEach(task => {
        if (!task.created_at) return;
        const date = task.created_at.split(' ')[0]; // Assumes YYYY-MM-DD HH:MM:SS format
        const priority = task.priority || 'medium';
        const key = `${date}|${priority}`;
        
        counts[key] = (counts[key] || 0) + 1;
    });

    for (const key in counts) {
        const [date, priority] = key.split('|');
        result.push({ date, priority, count: counts[key] });
    }
    return result;
}

function calculateDailyCompleted(tasks) {
    const result = [];
    const counts = {};

    tasks.forEach(task => {
        if (!task.completed_at) return;
        const date = task.completed_at.split(' ')[0];
        const priority = task.priority || 'medium';
        const key = `${date}|${priority}`;
        
        counts[key] = (counts[key] || 0) + 1;
    });

    for (const key in counts) {
        const [date, priority] = key.split('|');
        result.push({ date, priority, count: counts[key] });
    }
    return result;
}

// Render Tasks Created Chart
function renderTasksCreatedChart(labels, dailyData) {
    const ctx = document.getElementById('tasks-created-chart');
    if (!ctx) return;

    // Destroy existing chart
    if (tasksCreatedChart) {
        tasksCreatedChart.destroy();
    }

    const priorities = ['high', 'medium', 'low'];
    const datasets = [];

    const colors = {
        'high': 'rgba(239, 68, 68, 1)',
        'medium': 'rgba(245, 158, 11, 1)',
        'low': 'rgba(16, 185, 129, 1)'
    };

    const bgColors = {
        'high': 'rgba(239, 68, 68, 0.1)',
        'medium': 'rgba(245, 158, 11, 0.1)',
        'low': 'rgba(16, 185, 129, 0.1)'
    };

    priorities.forEach(priority => {
        const data = labels.map(date => {
            const found = dailyData.find(d => d.date === date && d.priority === priority);
            return found ? found.count : 0;
        });

        datasets.push({
            label: priority.charAt(0).toUpperCase() + priority.slice(1) + ' Priority',
            data: data,
            borderColor: colors[priority],
            backgroundColor: bgColors[priority],
            tension: 0.4,
            fill: true,
            pointRadius: 4,
            pointHoverRadius: 6
        });
    });

    tasksCreatedChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels.map(d => formatChartDate(d)),
            datasets: datasets
        },
        options: {
            responsive: true,
            maintainAspectRatio: true,
            plugins: {
                legend: {
                    display: true,
                    position: 'bottom',
                    labels: {
                        color: '#e4e4e7',
                        padding: 15,
                        font: {
                            size: 12
                        }
                    }
                },
                tooltip: {
                    mode: 'index',
                    intersect: false,
                    backgroundColor: 'rgba(26, 26, 46, 0.95)',
                    titleColor: '#e4e4e7',
                    bodyColor: '#e4e4e7',
                    borderColor: '#6366f1',
                    borderWidth: 1
                }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    ticks: {
                        color: '#a1a1aa',
                        stepSize: 1
                    },
                    grid: {
                        color: 'rgba(39, 39, 42, 0.5)'
                    }
                },
                x: {
                    ticks: {
                        color: '#a1a1aa'
                    },
                    grid: {
                        color: 'rgba(39, 39, 42, 0.5)'
                    }
                }
            }
        }
    });
}

// Render Tasks Completed Chart
function renderTasksCompletedChart(labels, dailyData) {
    const ctx = document.getElementById('tasks-completed-chart');
    if (!ctx) return;

    // Destroy existing chart
    if (tasksCompletedChart) {
        tasksCompletedChart.destroy();
    }

    const priorities = ['high', 'medium', 'low'];
    const datasets = [];

    const colors = {
        'high': 'rgba(239, 68, 68, 1)',
        'medium': 'rgba(245, 158, 11, 1)',
        'low': 'rgba(16, 185, 129, 1)'
    };

    const bgColors = {
        'high': 'rgba(239, 68, 68, 0.1)',
        'medium': 'rgba(245, 158, 11, 0.1)',
        'low': 'rgba(16, 185, 129, 0.1)'
    };

    priorities.forEach(priority => {
        const data = labels.map(date => {
            const found = dailyData.find(d => d.date === date && d.priority === priority);
            return found ? found.count : 0;
        });

        datasets.push({
            label: priority.charAt(0).toUpperCase() + priority.slice(1) + ' Priority',
            data: data,
            borderColor: colors[priority],
            backgroundColor: bgColors[priority],
            tension: 0.4,
            fill: true,
            pointRadius: 4,
            pointHoverRadius: 6
        });
    });

    tasksCompletedChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels.map(d => formatChartDate(d)),
            datasets: datasets
        },
        options: {
            responsive: true,
            maintainAspectRatio: true,
            plugins: {
                legend: {
                    display: true,
                    position: 'bottom',
                    labels: {
                        color: '#e4e4e7',
                        padding: 15,
                        font: {
                            size: 12
                        }
                    }
                },
                tooltip: {
                    mode: 'index',
                    intersect: false,
                    backgroundColor: 'rgba(26, 26, 46, 0.95)',
                    titleColor: '#e4e4e7',
                    bodyColor: '#e4e4e7',
                    borderColor: '#6366f1',
                    borderWidth: 1
                }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    ticks: {
                        color: '#a1a1aa',
                        stepSize: 1
                    },
                    grid: {
                        color: 'rgba(39, 39, 42, 0.5)'
                    }
                },
                x: {
                    ticks: {
                        color: '#a1a1aa'
                    },
                    grid: {
                        color: 'rgba(39, 39, 42, 0.5)'
                    }
                }
            }
        }
    });
}

// Get last 7 days in YYYY-MM-DD format
function getLast7Days() {
    const dates = [];
    for (let i = 6; i >= 0; i--) {
        const date = new Date();
        date.setDate(date.getDate() - i);
        dates.push(formatDateToLocalYMD(date));
    }
    return dates.reverse(); // Standardize as [newest, ..., oldest]
}

// Format date for chart labels
function formatChartDate(dateString) {
    let date;
    // Handle YYYY-MM-DD strings explicitly as local time
    if (typeof dateString === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(dateString)) {
        const [y, m, d] = dateString.split('-').map(Number);
        date = new Date(y, m - 1, d);
    } else {
        date = new Date(dateString);
    }

    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    // Reset time for comparison
    today.setHours(0, 0, 0, 0);
    yesterday.setHours(0, 0, 0, 0);
    date.setHours(0, 0, 0, 0);

    if (date.getTime() === today.getTime()) {
        return 'Today';
    } else if (date.getTime() === yesterday.getTime()) {
        return 'Yesterday';
    } else {
        const options = { month: 'short', day: 'numeric' };
        return date.toLocaleDateString('en-US', options);
    }
}

// Modal management
function openAddTaskModal() {
    document.getElementById('modal-title').textContent = 'Add New Task';
    document.getElementById('task-form').reset();
    document.getElementById('task-id').value = '';

    // Set default dates
    const today = new Date().toISOString().split('T')[0];
    document.getElementById('task-created-date').value = today;
    document.getElementById('task-due-date').value = today;

    document.getElementById('task-modal').style.display = 'block';
}

function editTask(taskId) {
    const task = tasks.find(t => t.id === taskId);
    if (!task) return;

    // Reset form first to clear any previous data
    document.getElementById('task-form').reset();

    document.getElementById('modal-title').textContent = 'Edit Task';
    document.getElementById('task-id').value = task.id;
    document.getElementById('task-title').value = task.title;
    document.getElementById('task-description').value = task.description || '';
    document.getElementById('task-status').value = task.status;
    document.getElementById('task-priority').value = task.priority || 'medium';
    document.getElementById('task-project').value = task.project || '';
    document.getElementById('task-created-date').value = task.created_at ? task.created_at.split(' ')[0] : '';
    document.getElementById('task-due-date').value = task.due_date || '';
    document.getElementById('task-modal').style.display = 'block';
}

function closeModal() {
    document.getElementById('task-modal').style.display = 'none';
    document.getElementById('task-form').reset();
    document.getElementById('task-id').value = '';
}

// Task CRUD operations
async function saveTask(event) {
    event.preventDefault();

    const taskId = document.getElementById('task-id').value;
    const title = document.getElementById('task-title').value;
    const description = document.getElementById('task-description').value;
    const status = document.getElementById('task-status').value;
    const priority = document.getElementById('task-priority').value;
    const project = document.getElementById('task-project').value;
    const createdDate = document.getElementById('task-created-date').value;
    const dueDate = document.getElementById('task-due-date').value;

    const taskData = {
        title,
        description,
        status,
        priority,
        project,
        created_at: createdDate || null,
        due_date: dueDate || null
    };

    try {
        if (taskId) {
            await fetch(`/api/tasks/${taskId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(taskData)
            });
        } else {
            await fetch('/api/tasks', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(taskData)
            });
        }

        closeModal();
        await loadTasks();
    } catch (error) {
        console.error('Error saving task:', error);
        Swal.fire({
            icon: 'error',
            title: 'Error',
            text: 'Failed to save task',
            confirmButtonColor: '#6366f1'
        });
    }
}

async function deleteTask(taskId) {
    const result = await Swal.fire({
        title: 'Are you sure?',
        text: "You won't be able to revert this!",
        icon: 'warning',
        showCancelButton: true,
        confirmButtonColor: '#ef4444',
        cancelButtonColor: '#6b7280',
        confirmButtonText: 'Yes, delete it!'
    });

    if (!result.isConfirmed) return;

    try {
        await fetch(`/api/tasks/${taskId}`, { method: 'DELETE' });
        await loadTasks();
        Swal.fire({
            icon: 'success',
            title: 'Deleted!',
            text: 'Task has been deleted.',
            confirmButtonColor: '#6366f1',
            timer: 2000
        });
    } catch (error) {
        console.error('Error deleting task:', error);
        Swal.fire({
            icon: 'error',
            title: 'Error',
            text: 'Failed to delete task',
            confirmButtonColor: '#6366f1'
        });
    }
}

async function updateTaskStatus(taskId, newStatus) {
    const task = tasks.find(t => t.id === taskId);
    if (!task) return;

    try {
        await fetch(`/api/tasks/${taskId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                title: task.title,
                description: task.description,
                status: newStatus,
                priority: task.priority || 'medium',
                project: task.project || '',
                due_date: task.due_date || null,
                created_at: task.created_at || null
            })
        });
        await loadTasks();
    } catch (error) {
        console.error('Error updating task status:', error);
    }
}

// Timer management
async function startTimer(taskId) {
    try {
        // Stop all other running timers first
        const runningTasks = Object.keys(activeTimers);
        for (const runningTaskId of runningTasks) {
            if (parseInt(runningTaskId) !== taskId) {
                await stopTimer(parseInt(runningTaskId), false);
            }
        }

        // Start new timer
        await fetch(`/api/tasks/${taskId}/start-timer`, { method: 'POST' });

        // Store the start time for this timer session
        const task = tasks.find(t => t.id === taskId);
        timerStartTimes[taskId] = {
            startTime: new Date(),
            baseTimeSpent: task ? task.time_spent || 0 : 0
        };

        activeTimers[taskId] = setInterval(() => {
            updateTaskTimer(taskId);
        }, 1000); // Update every second
        renderTodoList();
        renderKanban();
    } catch (error) {
        console.error('Error starting timer:', error);
        Swal.fire({
            icon: 'error',
            title: 'Error',
            text: 'Failed to start timer',
            confirmButtonColor: '#6366f1'
        });
    }
}

async function stopTimer(taskId, shouldReload = true) {
    try {
        const response = await fetch(`/api/tasks/${taskId}/stop-timer`, { method: 'POST' });

        if (!response.ok) {
            throw new Error('Failed to stop timer');
        }

        // Clear the interval timer
        if (activeTimers[taskId]) {
            clearInterval(activeTimers[taskId]);
            delete activeTimers[taskId];
        }

        // Clear the start time tracking
        if (timerStartTimes[taskId]) {
            delete timerStartTimes[taskId];
        }

        // Reload tasks and re-render
        if (shouldReload) {
            await loadTasks();
            renderTodoList();
            renderKanban();
        }
    } catch (error) {
        console.error('Error stopping timer:', error);
        if (shouldReload) {
            Swal.fire({
                icon: 'error',
                title: 'Error',
                text: 'Failed to stop timer',
                confirmButtonColor: '#6366f1'
            });
        }
    }
}

function updateTaskTimer(taskId) {
    const task = tasks.find(t => t.id === taskId);
    if (!task) return;

    // Calculate time based on start time if available
    if (timerStartTimes[taskId]) {
        const now = new Date();
        const elapsed = Math.floor((now - timerStartTimes[taskId].startTime) / 1000);
        task.time_spent = timerStartTimes[taskId].baseTimeSpent + elapsed;
    } else {
        // Fallback to simple increment (shouldn't happen with new logic)
        task.time_spent = (task.time_spent || 0) + 1;
    }

    // Update display without full reload
    const taskElements = document.querySelectorAll(`[data-task-id="${taskId}"]`);
    taskElements.forEach(el => {
        const timeDisplay = el.querySelector('.task-time-display');
        if (timeDisplay) {
            timeDisplay.textContent = `⏱️ ${formatTime(task.time_spent)}`;
        }
        const kanbanTimeDisplay = el.querySelector('.kanban-card-time');
        if (kanbanTimeDisplay) {
            kanbanTimeDisplay.textContent = `⏱️ ${formatTime(task.time_spent)}`;
        }
    });
}

// Utility functions
function formatTime(seconds) {
    if (!seconds) return '00:00:00';
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;

    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

function getStatusLabel(status) {
    const labels = {
        'todo': 'Todo',
        'in-progress': 'In Progress',
        'done': 'Done'
    };
    return labels[status] || status;
}

function capitalizeFirst(str) {
    return str.charAt(0).toUpperCase() + str.slice(1);
}

function formatDate(dateString) {
    if (!dateString) return '';
    let date;
    if (/^\d{4}-\d{2}-\d{2}$/.test(dateString)) {
        const [y, m, d] = dateString.split('-').map(Number);
        date = new Date(y, m - 1, d);
    } else {
        date = new Date(dateString);
    }
    const options = { weekday: 'short', month: 'short', day: 'numeric' };
    return date.toLocaleDateString('en-US', options);
}

function formatDateShort(dateString) {
    if (!dateString) return '';
    let date;
    if (/^\d{4}-\d{2}-\d{2}$/.test(dateString)) {
        const [y, m, d] = dateString.split('-').map(Number);
        date = new Date(y, m - 1, d);
    } else {
        date = new Date(dateString);
    }
    const options = { month: 'short', day: 'numeric' };
    return date.toLocaleDateString('en-US', options);
}

function checkIfOverdue(task) {
    if (!task.due_date || task.status === 'done') return false;

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    let dueDate;
    // Handle YYYY-MM-DD string explicitly as local date
    if (/^\d{4}-\d{2}-\d{2}$/.test(task.due_date)) {
        const [y, m, d] = task.due_date.split('-').map(Number);
        dueDate = new Date(y, m - 1, d);
    } else {
        dueDate = new Date(task.due_date);
        dueDate.setHours(0, 0, 0, 0);
    }

    return dueDate < today;
}

// Filter functions
function getFilteredTasks() {
    const searchFilter = document.getElementById('filter-search')?.value.toLowerCase() || '';
    const projectFilter = document.getElementById('filter-project')?.value || '';
    const priorityFilter = document.getElementById('filter-priority')?.value || '';
    const statusFilter = document.getElementById('filter-status')?.value || '';
    const dateFromFilter = document.getElementById('filter-date-from')?.value || '';
    const dateToFilter = document.getElementById('filter-date-to')?.value || '';

    // Check if we are on the dashboard view
    const dashboardView = document.getElementById('dashboard-view');
    const isDashboard = dashboardView && dashboardView.style.display !== 'none';

    return tasks.filter(task => {
        // Search filter - skip if on dashboard
        if (!isDashboard && searchFilter && !task.title.toLowerCase().includes(searchFilter)) return false;

        // Project filter
        if (projectFilter && task.project !== projectFilter) return false;

        // Priority filter
        if (priorityFilter && task.priority !== priorityFilter) return false;

        // Status filter
        if (statusFilter && task.status !== statusFilter) return false;

        // Date range filter (based on Created At) - skip if on dashboard
        if (!isDashboard && (dateFromFilter || dateToFilter)) {
            const createdDate = task.created_at ? task.created_at.split(' ')[0] : '';
            
            if (dateFromFilter) {
                if (!createdDate || createdDate < dateFromFilter) return false;
            }
            if (dateToFilter) {
                if (!createdDate || createdDate > dateToFilter) return false;
            }
        }

        return true;
    });
}

function populateProjectFilter() {
    const projectFilter = document.getElementById('filter-project');
    if (!projectFilter) return;

    // Get unique projects
    const projects = [...new Set(tasks.map(t => t.project).filter(p => p))];

    // Save current selection
    const currentValue = projectFilter.value;

    // Clear and repopulate
    projectFilter.innerHTML = '<option value="">All Projects</option>';
    projects.sort().forEach(project => {
        const option = document.createElement('option');
        option.value = project;
        option.textContent = `📁 ${project}`;
        projectFilter.appendChild(option);
    });

    // Restore selection
    projectFilter.value = currentValue;
}

function initDefaultFilters() {
    const quickDate = document.getElementById('filter-quick-date');
    if (quickDate) {
        quickDate.value = 'last-week';
        applyQuickDate(false); // Apply without re-rendering since tasks aren't loaded yet
    }
}

function applyQuickDate(shouldApply = true) {
    const quickDate = document.getElementById('filter-quick-date').value;
    const dateFromInput = document.getElementById('filter-date-from');
    const dateToInput = document.getElementById('filter-date-to');
    
    if (!quickDate) return;

    const now = new Date();
    let fromDate = new Date();
    let toDate = new Date();

    // Set toDate to end of today
    toDate.setHours(23, 59, 59, 999);

    switch (quickDate) {
        case 'today':
            fromDate.setHours(0, 0, 0, 0);
            break;
        case 'yesterday':
            fromDate.setDate(now.getDate() - 1);
            fromDate.setHours(0, 0, 0, 0);
            toDate.setDate(now.getDate() - 1);
            toDate.setHours(23, 59, 59, 999);
            break;
        case 'last-week':
            fromDate.setDate(now.getDate() - 6); // Last 7 days including today
            fromDate.setHours(0, 0, 0, 0);
            break;
        case 'last-month':
            fromDate.setDate(now.getDate() - 29); // Last 30 days including today
            fromDate.setHours(0, 0, 0, 0);
            break;
        case 'last-year':
            fromDate.setDate(now.getDate() - 364); // Last 365 days including today
            fromDate.setHours(0, 0, 0, 0);
            break;
    }

    dateFromInput.value = formatDateToLocalYMD(fromDate);
    dateToInput.value = formatDateToLocalYMD(toDate);

    if (shouldApply) {
        applyFilters();
    }
}

function applyFilters() {
    const currentView = document.querySelector('.view[style="display: block;"]');

    renderTodoList();
    renderKanban();

    // Reload dashboard if it's the current view
    if (currentView && currentView.id === 'dashboard-view') {
        loadDashboard();
    }

    // Re-render credentials if it's the current view
    if (currentView && currentView.id === 'credentials-view') {
        renderCredentials();
    }
}

function clearFilters() {
    document.getElementById('filter-search').value = '';
    document.getElementById('filter-project').value = '';
    document.getElementById('filter-priority').value = '';
    document.getElementById('filter-status').value = '';
    document.getElementById('filter-quick-date').value = '';
    document.getElementById('filter-date-from').value = '';
    document.getElementById('filter-date-to').value = '';
    applyFilters();
}

// Close modal when clicking outside
window.onclick = function(event) {
    const modal = document.getElementById('task-modal');
    const credentialModal = document.getElementById('credential-modal');
    const noteModal = document.getElementById('note-modal');
    if (event.target === modal) {
        closeModal();
    }
    if (event.target === credentialModal) {
        closeCredentialModal();
    }
    if (event.target === noteModal) {
        closeNoteModal();
    }
}

// ========== SERVER CREDENTIALS FUNCTIONS ==========

// Credential tags state
let credentialSelectedTags = [];
let credentialFilterSelectedTags = [];
let allCredentialTags = [];
let noteSelectedTags = [];
let noteFilterSelectedTags = [];
let allNoteTags = [];

// Load credentials from API
async function loadCredentials() {
    try {
        const response = await fetch('/api/credentials');
        credentials = await response.json();
        await loadProjects(); // Load projects for dropdown
        await loadAllCredentialTags();
        populateCredentialProjectList();
        populateCredentialFilters();
        renderCredentials();
    } catch (error) {
        console.error('Error loading credentials:', error);
    }
}

// Load all credential tags
async function loadAllCredentialTags() {
    try {
        const response = await fetch('/api/credentials/tags');
        allCredentialTags = await response.json();
    } catch (error) {
        console.error('Error loading credential tags:', error);
    }
}

// Populate project list for credential form
function populateCredentialProjectList() {
    const datalist = document.getElementById('credential-project-list');
    if (datalist) {
        datalist.innerHTML = '';

        // Get unique projects from tasks
        fetch('/api/projects')
            .then(response => response.json())
            .then(projects => {
                projects.forEach(project => {
                    const option = document.createElement('option');
                    option.value = project;
                    datalist.appendChild(option);
                });
            });
    }
}

// Populate credential filters
function populateCredentialFilters() {
    // Populate project filter
    const projectFilter = document.getElementById('credentials-project-filter');
    const projects = [...new Set(credentials.map(c => c.project).filter(p => p))];

    projectFilter.innerHTML = '<option value="">All Projects</option>';
    projects.sort().forEach(project => {
        const option = document.createElement('option');
        option.value = project;
        option.textContent = `📁 ${project}`;
        projectFilter.appendChild(option);
    });
}

// Get filtered credentials
function getFilteredCredentials() {
    let filtered = [...credentials];

    // Filter by search (title or IP)
    const searchTerm = document.getElementById('credentials-search')?.value.toLowerCase() || '';
    if (searchTerm) {
        filtered = filtered.filter(cred =>
            cred.title.toLowerCase().includes(searchTerm) ||
            cred.ip.toLowerCase().includes(searchTerm)
        );
    }

    // Filter by project
    const projectFilter = document.getElementById('credentials-project-filter')?.value || '';
    if (projectFilter) {
        filtered = filtered.filter(cred => cred.project === projectFilter);
    }

    // Filter by tags (space separated input)
    const tagInput = document.getElementById('credentials-filter-tag-input')?.value.toLowerCase().trim() || '';
    if (tagInput) {
        const searchTags = tagInput.split(/\s+/); // Split by whitespace
        filtered = filtered.filter(cred => {
            if (!cred.tags || cred.tags.length === 0) return false;
            // Check if ALL search tokens match at least one of the credential tags (partial matching allowed for better UX)
            const credTagsLower = cred.tags.map(t => t.toLowerCase());
            return searchTags.every(searchTag => 
                credTagsLower.some(credTag => credTag.includes(searchTag))
            );
        });
    }

    return filtered;
}

// Apply credential filters
function applyCredentialFilters() {
    renderCredentials();
}

// Clear credential filters
function clearCredentialFilters() {
    document.getElementById('credentials-search').value = '';
    document.getElementById('credentials-project-filter').value = '';
    document.getElementById('credentials-filter-tag-input').value = '';
    renderCredentials();
}

// Handle credential tag input
function handleCredentialTagInput(event) {
    if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        const input = event.target;
        const tag = input.value.trim();

        if (tag && !credentialSelectedTags.includes(tag)) {
            credentialSelectedTags.push(tag);
            renderCredentialTags();
            input.value = '';
            hideCredentialTagSuggestions();
        }
    }
}

// Show credential tag suggestions
function showCredentialTagSuggestions(event) {
    const input = event.target;
    const value = input.value.trim().toLowerCase();
    const suggestionsContainer = document.getElementById('credential-tag-suggestions');

    if (!value) {
        suggestionsContainer.classList.remove('active');
        return;
    }

    // Filter tags that match and are not already selected
    const suggestions = allCredentialTags.filter(tag =>
        tag.toLowerCase().includes(value) &&
        !credentialSelectedTags.includes(tag)
    );

    if (suggestions.length === 0) {
        suggestionsContainer.classList.remove('active');
        return;
    }

    // Render suggestions
    suggestionsContainer.innerHTML = suggestions.map(tag =>
        `<div class="tag-suggestion-item" onclick="selectCredentialTag('${tag}')">${tag}</div>`
    ).join('');
    suggestionsContainer.classList.add('active');
}

// Hide credential tag suggestions
function hideCredentialTagSuggestions() {
    const suggestionsContainer = document.getElementById('credential-tag-suggestions');
    suggestionsContainer.classList.remove('active');
}

// Select credential tag from suggestions
function selectCredentialTag(tag) {
    if (!credentialSelectedTags.includes(tag)) {
        credentialSelectedTags.push(tag);
        renderCredentialTags();
    }
    document.getElementById('credential-tag-input').value = '';
    hideCredentialTagSuggestions();
}

// Render credential tags
function renderCredentialTags() {
    const container = document.getElementById('credential-selected-tags');
    container.innerHTML = '';

    credentialSelectedTags.forEach(tag => {
        const tagEl = document.createElement('div');
        tagEl.className = 'tag-item';
        tagEl.innerHTML = `
            <span>${tag}</span>
            <span class="tag-remove" onclick="removeCredentialTag('${tag}')">&times;</span>
        `;
        container.appendChild(tagEl);
    });

    // Update hidden input
    document.getElementById('credential-tags').value = JSON.stringify(credentialSelectedTags);
}

// Remove credential tag
function removeCredentialTag(tag) {
    credentialSelectedTags = credentialSelectedTags.filter(t => t !== tag);
    renderCredentialTags();
}

// Render credentials list
function renderCredentials() {
    const credentialsList = document.getElementById('credentials-list');
    credentialsList.innerHTML = '';

    const filteredCredentials = getFilteredCredentials();
    
    // Update Summary
    updateCredentialSummary(filteredCredentials);

    if (filteredCredentials.length === 0) {
        if (credentials.length === 0) {
            credentialsList.innerHTML = '<p style="text-align: center; color: var(--text-secondary); padding: 40px;">No credentials saved yet.</p>';
        } else {
            credentialsList.innerHTML = '<p style="text-align: center; color: var(--text-secondary); padding: 40px;">No credentials match the current filters.</p>';
        }
        return;
    }

    filteredCredentials.forEach(credential => {
        const card = document.createElement('div');
        card.className = 'credential-card';

        // Tags HTML
        const tagsHtml = credential.tags && credential.tags.length > 0 ?
            `<div class="credential-tags">${credential.tags.map(tag => `<span class="credential-tag">🏷️ ${tag}</span>`).join('')}</div>` :
            '';

        const costHtml = (credential.cost_usd > 0 || credential.cost_idr > 0) ? `
            <div class="credential-field" style="margin-top: 10px; border-top: 1px solid rgba(255,255,255,0.05); padding-top: 10px;">
                <span class="credential-label">💳 Monthly Cost</span>
                <div style="display: flex; gap: 15px; font-size: 13px;">
                    ${credential.cost_usd > 0 ? `<span style="color: #3b82f6;">$${credential.cost_usd.toFixed(2)}</span>` : ''}
                    ${credential.cost_idr > 0 ? `<span style="color: #10b981;">Rp ${credential.cost_idr.toLocaleString('id-ID')}</span>` : ''}
                </div>
            </div>
        ` : '';

        const notesHtml = credential.notes ? `
            <div class="credential-field" style="margin-top: 10px; border-top: 1px solid rgba(255,255,255,0.05); padding-top: 10px;">
                <span class="credential-label">🛠️ Services</span>
                <div style="font-size: 13px; color: var(--text-secondary); white-space: pre-wrap;">${credential.notes}</div>
            </div>
        ` : '';

        card.innerHTML = `
            <div class="credential-header">
                <div>
                    <div class="credential-title">${credential.title}</div>
                    <div class="credential-meta">
                        ${credential.project ? `<span class="credential-project">📁 ${credential.project}</span>` : ''}
                    </div>
                    ${tagsHtml}
                </div>
                <div class="credential-actions">
                    <button class="btn-edit" onclick="editCredential(${credential.id})" title="Edit">✏️</button>
                    <button class="btn-delete" onclick="deleteCredential(${credential.id})" title="Delete">🗑️</button>
                </div>
            </div>
            <div class="credential-info">
                <div class="credential-field">
                    <span class="credential-label">🌐 IP Address</span>
                    <div class="credential-value-wrapper">
                        <div class="credential-value">${credential.ip}</div>
                        <div class="credential-btn-group">
                            <button class="copy-btn" onclick="copyToClipboard('${credential.ip}', event)">📋 Copy</button>
                        </div>
                    </div>
                </div>
                <div class="credential-field">
                    <span class="credential-label">👤 Username</span>
                    <div class="credential-value-wrapper">
                        <div class="credential-value">${credential.username || '-'}</div>
                        <div class="credential-btn-group">
                            <button class="copy-btn" onclick="copyToClipboard('${credential.username || ''}', event)">📋 Copy</button>
                        </div>
                    </div>
                </div>
                <div class="credential-field">
                    <span class="credential-label">🔑 Password</span>
                    <div class="credential-value-wrapper">
                        <div class="credential-value">
                            <input type="password" id="password-${credential.id}" value="${credential.password}" readonly>
                        </div>
                        <div class="credential-btn-group">
                            <button class="password-toggle" onclick="togglePassword(${credential.id}, event)" title="Show/Hide">👁️</button>
                            <button class="copy-btn" onclick="copyToClipboard('${credential.password}', event)">📋 Copy</button>
                        </div>
                    </div>
                </div>
                ${costHtml}
                ${notesHtml}
            </div>
        `;
        credentialsList.appendChild(card);
    });
}

function updateCredentialSummary(filteredList) {
    const totalUSD = filteredList.reduce((sum, c) => sum + (c.cost_usd || 0), 0);
    const totalIDR = filteredList.reduce((sum, c) => sum + (c.cost_idr || 0), 0);

    const idrEl = document.getElementById('cred-total-idr');
    const usdEl = document.getElementById('cred-total-usd');

    if (idrEl) idrEl.textContent = `Rp ${totalIDR.toLocaleString('id-ID')}`;
    if (usdEl) usdEl.textContent = `$${totalUSD.toFixed(2)}`;
}

// Open add credential modal
function openAddCredentialModal() {
    document.getElementById('credential-modal-title').textContent = 'Add Server Credential';
    document.getElementById('credential-form').reset();
    document.getElementById('credential-id').value = '';
    
    // Reset new fields
    document.getElementById('credential-username').value = '';
    document.getElementById('credential-cost-usd').value = 0;
    document.getElementById('credential-cost-idr').value = 0;
    document.getElementById('credential-notes').value = '';

    credentialSelectedTags = [];
    renderCredentialTags();
    document.getElementById('credential-modal').style.display = 'block';
}

// Close credential modal
function closeCredentialModal() {
    document.getElementById('credential-modal').style.display = 'none';
}

// Save credential
async function saveCredential(event) {
    event.preventDefault();

    const id = document.getElementById('credential-id').value;
    const credentialData = {
        title: document.getElementById('credential-title').value,
        project: document.getElementById('credential-project').value,
        ip: document.getElementById('credential-ip').value,
        username: document.getElementById('credential-username').value,
        password: document.getElementById('credential-password').value,
        cost_usd: parseFloat(document.getElementById('credential-cost-usd').value) || 0,
        cost_idr: parseFloat(document.getElementById('credential-cost-idr').value) || 0,
        notes: document.getElementById('credential-notes').value,
        tags: credentialSelectedTags
    };

    try {
        let response;
        if (id) {
            response = await fetch(`/api/credentials/${id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(credentialData)
            });
        } else {
            response = await fetch('/api/credentials', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(credentialData)
            });
        }

        if (response.ok) {
            closeCredentialModal();
            await loadCredentials();
            Swal.fire({
                icon: 'success',
                title: id ? 'Credential Updated!' : 'Credential Added!',
                toast: true,
                position: 'top-end',
                showConfirmButton: false,
                timer: 2000,
                timerProgressBar: true
            });
        }
    } catch (error) {
        console.error('Error saving credential:', error);
        Swal.fire({
            icon: 'error',
            title: 'Error',
            text: 'Failed to save credential'
        });
    }
}

// Edit credential
function editCredential(id) {
    const credential = credentials.find(c => c.id === id);
    if (!credential) return;

    document.getElementById('credential-modal-title').textContent = 'Edit Server Credential';
    document.getElementById('credential-id').value = credential.id;
    document.getElementById('credential-title').value = credential.title;
    document.getElementById('credential-project').value = credential.project || '';
    document.getElementById('credential-ip').value = credential.ip;
    document.getElementById('credential-username').value = credential.username || '';
    document.getElementById('credential-password').value = credential.password;
    document.getElementById('credential-cost-usd').value = credential.cost_usd || 0;
    document.getElementById('credential-cost-idr').value = credential.cost_idr || 0;
    document.getElementById('credential-notes').value = credential.notes || '';

    // Set tags
    credentialSelectedTags = credential.tags || [];
    renderCredentialTags();

    document.getElementById('credential-modal').style.display = 'block';
}

// Delete credential
async function deleteCredential(id) {
    const result = await Swal.fire({
        title: 'Delete Credential?',
        text: 'This action cannot be undone!',
        icon: 'warning',
        showCancelButton: true,
        confirmButtonColor: '#ef4444',
        cancelButtonColor: '#6b7280',
        confirmButtonText: 'Yes, delete it!',
        cancelButtonText: 'Cancel'
    });

    if (result.isConfirmed) {
        try {
            const response = await fetch(`/api/credentials/${id}`, {
                method: 'DELETE'
            });

            if (response.ok) {
                await loadCredentials();
                Swal.fire({
                    icon: 'success',
                    title: 'Deleted!',
                    text: 'Credential has been deleted.',
                    toast: true,
                    position: 'top-end',
                    showConfirmButton: false,
                    timer: 2000,
                    timerProgressBar: true
                });
            }
        } catch (error) {
            console.error('Error deleting credential:', error);
        }
    }
}

// Toggle password visibility
function togglePassword(id, e) {
    if (e) e.preventDefault();
    const input = document.getElementById(`password-${id}`);
    const button = e ? e.target : event.target;

    if (input.type === 'password') {
        input.type = 'text';
        button.textContent = '🙈';
    } else {
        input.type = 'password';
        button.textContent = '👁️';
    }
}

// Copy to clipboard
async function copyToClipboard(text, e) {
    if (e) e.preventDefault();
    try {
        await navigator.clipboard.writeText(text);
        Swal.fire({
            icon: 'success',
            title: 'Copied to clipboard!',
            toast: true,
            position: 'top-end',
            showConfirmButton: false,
            timer: 1500,
            timerProgressBar: true
        });
    } catch (error) {
        console.error('Error copying to clipboard:', error);
    }
}

// Edit time spent
async function editTimeSpent(taskId, e) {
    if (e) e.stopPropagation();

    const task = tasks.find(t => t.id === taskId);
    if (!task) return;

    const currentSeconds = task.time_spent || 0;
    const hours = Math.floor(currentSeconds / 3600);
    const minutes = Math.floor((currentSeconds % 3600) / 60);
    const seconds = currentSeconds % 60;

    const { value: formValues } = await Swal.fire({
        title: 'Edit Time Spent',
        html: `
            <div style="display: flex; gap: 10px; justify-content: center; align-items: center;">
                <div style="display: flex; flex-direction: column; align-items: center;">
                    <label style="margin-bottom: 5px; font-size: 12px; color: var(--text-secondary);">Hours</label>
                    <input id="hours-input" type="number" min="0" value="${hours}"
                           style="width: 70px; padding: 8px; font-size: 16px; text-align: center;
                                  background: var(--bg-tertiary); color: var(--text-primary);
                                  border: 1px solid var(--border); border-radius: 6px;">
                </div>
                <span style="font-size: 24px; margin-top: 20px;">:</span>
                <div style="display: flex; flex-direction: column; align-items: center;">
                    <label style="margin-bottom: 5px; font-size: 12px; color: var(--text-secondary);">Minutes</label>
                    <input id="minutes-input" type="number" min="0" max="59" value="${minutes}"
                           style="width: 70px; padding: 8px; font-size: 16px; text-align: center;
                                  background: var(--bg-tertiary); color: var(--text-primary);
                                  border: 1px solid var(--border); border-radius: 6px;">
                </div>
                <span style="font-size: 24px; margin-top: 20px;">:</span>
                <div style="display: flex; flex-direction: column; align-items: center;">
                    <label style="margin-bottom: 5px; font-size: 12px; color: var(--text-secondary);">Seconds</label>
                    <input id="seconds-input" type="number" min="0" max="59" value="${seconds}"
                           style="width: 70px; padding: 8px; font-size: 16px; text-align: center;
                                  background: var(--bg-tertiary); color: var(--text-primary);
                                  border: 1px solid var(--border); border-radius: 6px;">
                </div>
            </div>
        `,
        focusConfirm: false,
        showCancelButton: true,
        confirmButtonText: 'Save',
        cancelButtonText: 'Cancel',
        confirmButtonColor: '#6366f1',
        background: 'var(--bg-secondary)',
        color: 'var(--text-primary)',
        preConfirm: () => {
            const h = parseInt(document.getElementById('hours-input').value) || 0;
            const m = parseInt(document.getElementById('minutes-input').value) || 0;
            const s = parseInt(document.getElementById('seconds-input').value) || 0;
            return { hours: h, minutes: m, seconds: s };
        }
    });

    if (formValues) {
        const newTimeSpent = (formValues.hours * 3600) + (formValues.minutes * 60) + formValues.seconds;

        try {
            const response = await fetch(`/api/tasks/${taskId}/time-spent`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ time_spent: newTimeSpent })
            });

            if (response.ok) {
                task.time_spent = newTimeSpent;

                // Update timerStartTimes if timer is active
                if (timerStartTimes[taskId]) {
                    timerStartTimes[taskId].baseTimeSpent = newTimeSpent;
                    timerStartTimes[taskId].startTime = new Date();
                }

                renderTodoList();
                renderKanban();

                Swal.fire({
                    icon: 'success',
                    title: 'Time Updated!',
                    toast: true,
                    position: 'top-end',
                    showConfirmButton: false,
                    timer: 2000,
                    timerProgressBar: true
                });
            }
        } catch (error) {
            console.error('Error updating time spent:', error);
            Swal.fire({
                icon: 'error',
                title: 'Error',
                text: 'Failed to update time spent'
            });
        }
    }
}


// ==================== NOTES SYSTEM ====================

let notes = [];
let folders = [];
let expandedFolders = new Set(); // Track expanded folder IDs
let currentFolderId = null; // null = all notes, 'uncategorized' = no folder
let allNotes = []; // For internal linking
let currentNoteLinkedNotes = []; // Store linked note IDs for current note

// Load folders from API
async function loadFolders() {
    try {
        const response = await fetch('/api/folders');
        folders = await response.json();
        renderFolderTree();
        // Don't update dropdowns here if we switch to SweetAlert, but useful for Note Modal
        updateFolderSelects(); 
    } catch (error) {
        console.error('Error loading folders:', error);
    }
}

function updateFolderSelects() {
    // Update Folder Select in Note Modal
    const noteFolderSelect = document.getElementById('note-folder');
    if (noteFolderSelect) {
        const currentVal = noteFolderSelect.value;
        noteFolderSelect.innerHTML = '<option value="">(No Folder)</option>';
        
        const addOptions = (parentId, level) => {
            const children = folders.filter(f => f.parent_id === parentId);
            children.forEach(folder => {
                const option = document.createElement('option');
                option.value = folder.id;
                option.textContent = '—'.repeat(level) + ' ' + folder.name;
                noteFolderSelect.appendChild(option);
                addOptions(folder.id, level + 1);
            });
        };
        addOptions(null, 0);
        noteFolderSelect.value = currentVal;
    }
}

function toggleFolder(e, folderId) {
    e.stopPropagation();
    if (expandedFolders.has(folderId)) {
        expandedFolders.delete(folderId);
    } else {
        expandedFolders.add(folderId);
    }
    renderFolderTree();
}

function renderFolderTree() {
    const treeContainer = document.getElementById('folder-tree');
    if (!treeContainer) return;

    treeContainer.innerHTML = '';

    const renderNode = (parentId, container, isRoot = false) => {
        // Sort by position, then by name
        const children = folders
            .filter(f => f.parent_id === parentId)
            .sort((a, b) => (a.position - b.position) || a.name.localeCompare(b.name));
            
        if (children.length === 0) return;

        // Create a wrapper for children if not root
        let childrenContainer = container;
        if (!isRoot) {
            childrenContainer = document.createElement('div');
            childrenContainer.className = 'folder-children';
            container.appendChild(childrenContainer);
        }
        
        children.forEach(folder => {
            const hasChildren = folders.some(f => f.parent_id === folder.id);
            const isExpanded = expandedFolders.has(folder.id);
            const folderWrapper = document.createElement('div');
            folderWrapper.className = 'folder-wrapper';
            
            // Item Row
            const itemDiv = document.createElement('div');
            itemDiv.className = `folder-item ${currentFolderId === folder.id ? 'active' : ''}`;
            itemDiv.draggable = true;
            itemDiv.dataset.folderId = folder.id;
            
            // DnD Events
            itemDiv.addEventListener('dragstart', handleFolderDragStart);
            itemDiv.addEventListener('dragover', handleDragOver);
            itemDiv.addEventListener('dragleave', handleDragLeave);
            itemDiv.addEventListener('drop', (e) => handleDropToFolder(e, folder.id));
            itemDiv.addEventListener('click', (e) => {
                if (!e.target.closest('.folder-actions') && !e.target.closest('.folder-toggle')) {
                    selectFolder(folder.id);
                }
            });

            // Toggle Icon
            const toggleIcon = hasChildren ? (isExpanded ? '▼' : '▶') : '';
            const toggleClass = hasChildren ? 'folder-toggle' : 'folder-toggle-placeholder';
            const toggleAction = hasChildren ? `onclick="toggleFolder(event, ${folder.id})"` : '';

            itemDiv.innerHTML = `
                <span class="${toggleClass}" ${toggleAction}>${toggleIcon}</span>
                <span class="folder-icon">📁</span>
                <span class="folder-name">${folder.name}</span>
                <div class="folder-actions">
                    <button class="folder-btn" onclick="editFolder(${folder.id})" title="Edit">✏️</button>
                </div>
            `;
            
            folderWrapper.appendChild(itemDiv);
            childrenContainer.appendChild(folderWrapper);
            
            // Recursive Children (only if expanded)
            if (isExpanded) {
                renderNode(folder.id, folderWrapper, false);
            }
        });
    };

    // Render root items (parent_id: null) directly into treeContainer
    renderNode(null, treeContainer, true);
}

function selectFolder(folderId) {
    currentFolderId = folderId;
    renderFolderTree(); // Re-render to update active state
    
    // Update Title
    const titleEl = document.getElementById('current-folder-title');
    if (folderId === null) titleEl.textContent = 'All Notes';
    else if (folderId === 'uncategorized') titleEl.textContent = 'Uncategorized Notes';
    else {
        const folder = folders.find(f => f.id === folderId);
        titleEl.textContent = folder ? folder.name : 'Unknown Folder';
    }
    
    filterNotes();
}

// Folder Modal Functions (Using SweetAlert2)
async function openFolderModal() {
    const folderOptions = getFolderOptionsHtml(null);
    
    const { value: formValues } = await Swal.fire({
        title: 'Create New Folder',
        html: `
            <div style="text-align: left;">
                <label style="display: block; margin-bottom: 8px; font-weight: 600; font-size: 13px;">Folder Name *</label>
                <input id="swal-folder-name" class="swal2-input" placeholder="Enter name" style="width: 100%; margin: 0 0 16px 0;">
                
                <label style="display: block; margin-bottom: 8px; font-weight: 600; font-size: 13px;">Parent Folder</label>
                <select id="swal-folder-parent" class="swal2-input" style="width: 100%; margin: 0;">
                    <option value="">(None - Root)</option>
                    ${folderOptions}
                </select>
            </div>
        `,
        focusConfirm: false,
        showCancelButton: true,
        confirmButtonText: 'Create',
        confirmButtonColor: '#6366f1',
        background: 'var(--bg-secondary)',
        color: 'var(--text-primary)',
        preConfirm: () => {
            const name = document.getElementById('swal-folder-name').value.trim();
            if (!name) {
                Swal.showValidationMessage('Please enter a name');
                return false;
            }
            return {
                name: name,
                parent_id: document.getElementById('swal-folder-parent').value || null
            };
        }
    });

    if (formValues) {
        try {
            const response = await fetch('/api/folders', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(formValues)
            });
            if (response.ok) {
                loadFolders();
                Swal.fire({ icon: 'success', title: 'Folder created!', toast: true, position: 'top-end', showConfirmButton: false, timer: 2000 });
            }
        } catch (error) {
            console.error('Error saving folder:', error);
        }
    }
}

async function editFolder(folderId) {
    const folder = folders.find(f => f.id === folderId);
    if (!folder) return;

    const folderOptions = getFolderOptionsHtml(folder.id);
    
    const swalResult = await Swal.fire({
        title: 'Edit Folder',
        html: `
            <div style="text-align: left;">
                <label style="display: block; margin-bottom: 8px; font-weight: 600; font-size: 13px;">Folder Name *</label>
                <input id="swal-folder-name" class="swal2-input" value="${folder.name}" style="width: 100%; margin: 0 0 16px 0;">
                
                <label style="display: block; margin-bottom: 8px; font-weight: 600; font-size: 13px;">Parent Folder</label>
                <select id="swal-folder-parent" class="swal2-input" style="width: 100%; margin: 0;">
                    <option value="">(None - Root)</option>
                    ${folderOptions}
                </select>
            </div>
        `,
        focusConfirm: false,
        showCancelButton: true,
        showDenyButton: true,
        confirmButtonText: 'Save',
        denyButtonText: 'Delete',
        denyButtonColor: 'var(--danger)',
        confirmButtonColor: '#6366f1',
        background: 'var(--bg-secondary)',
        color: 'var(--text-primary)',
        didOpen: () => {
            document.getElementById('swal-folder-parent').value = folder.parent_id || '';
        },
        preConfirm: () => {
            const name = document.getElementById('swal-folder-name').value.trim();
            if (!name) {
                Swal.showValidationMessage('Please enter a name');
                return false;
            }
            return {
                name: name,
                parent_id: document.getElementById('swal-folder-parent').value || null
            };
        }
    });

    if (swalResult.isConfirmed) {
        // Save logic
        try {
            const response = await fetch(`/api/folders/${folderId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(swalResult.value)
            });
            if (response.ok) {
                loadFolders();
                Swal.fire({ icon: 'success', title: 'Folder updated!', toast: true, position: 'top-end', showConfirmButton: false, timer: 2000 });
            }
        } catch (error) {
            console.error('Error saving folder:', error);
        }
    } else if (swalResult.isDenied) {
        // Delete logic
        deleteFolderConfirm(folderId);
    }
}

function getFolderOptionsHtml(excludeId = null) {
    let options = '';
    
    // Get all children of excludeId to prevent moving folder into its own subtree
    const getExcludedSubtree = (parentId) => {
        let ids = [parentId];
        const children = folders.filter(f => f.parent_id === parentId);
        children.forEach(c => {
            ids = ids.concat(getExcludedSubtree(c.id));
        });
        return ids;
    };
    
    const excludedIds = excludeId ? getExcludedSubtree(excludeId) : [];

    const addOptions = (parentId, level) => {
        const children = folders.filter(f => f.parent_id === parentId);
        children.forEach(folder => {
            if (!excludedIds.includes(folder.id)) {
                options += `<option value="${folder.id}">${'—'.repeat(level)} ${folder.name}</option>`;
                addOptions(folder.id, level + 1);
            }
        });
    };
    
    addOptions(null, 0);
    return options;
}

async function deleteFolderConfirm(folderId) {
    const result = await Swal.fire({
        title: 'Are you sure?',
        text: 'Subfolders and notes inside will be moved to the parent folder (or root).',
        icon: 'warning',
        showCancelButton: true,
        confirmButtonColor: 'var(--danger)',
        confirmButtonText: 'Yes, delete it!'
    });

    if (result.isConfirmed) {
        try {
            await fetch(`/api/folders/${folderId}`, { method: 'DELETE' });
            loadFolders();
            loadNotes(); // Reload notes as they might have moved to parent
            if (currentFolderId == folderId) selectFolder(null);
            Swal.fire({ icon: 'success', title: 'Deleted!', toast: true, position: 'top-end', showConfirmButton: false, timer: 2000 });
        } catch (error) {
            console.error('Error deleting folder:', error);
        }
    }
}

async function categorizeUncategorized(e) {
    if (e) e.stopPropagation();
    
    const { value: folderName } = await Swal.fire({
        title: 'Categorize Uncategorized Notes',
        input: 'text',
        inputLabel: 'Create a new folder for all notes without a folder',
        inputPlaceholder: 'Enter folder name',
        showCancelButton: true,
        confirmButtonColor: '#6366f1',
        background: 'var(--bg-secondary)',
        color: 'var(--text-primary)',
        inputValidator: (value) => {
            if (!value) return 'Please enter a name';
        }
    });

    if (folderName) {
        try {
            // 1. Create the folder
            const res = await fetch('/api/folders', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: folderName, parent_id: null })
            });
            const folder = await res.json();
            
            // 2. Move all uncategorized notes to this folder
            const uncategorizedNotes = allNotes.filter(n => !n.folder_id);
            for (const note of uncategorizedNotes) {
                await fetch(`/api/notes/${note.id}`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        title: note.title,
                        content: note.content,
                        task_id: note.task_id,
                        folder_id: folder.id,
                        tags: note.tags
                    })
                });
            }
            
            await loadFolders();
            await loadNotes();
            Swal.fire({ icon: 'success', title: 'Notes categorized!', toast: true, position: 'top-end', showConfirmButton: false, timer: 2000 });
        } catch (error) {
            console.error('Error categorizing notes:', error);
        }
    }
}

function closeFolderModal() {
    // No longer used with SweetAlert, but kept for compatibility if called elsewhere
}

async function saveFolder(event) {
    // No longer used with SweetAlert
}

async function deleteFolder() {
    // No longer used with SweetAlert
}

// Drag and Drop Logic
let draggedItem = null;
let draggedType = null; // 'folder' or 'note'
let dropAction = null; // 'before', 'after', 'inside'

function handleFolderDragStart(e) {
    draggedItem = e.target.dataset.folderId;
    draggedType = 'folder';
    e.dataTransfer.effectAllowed = 'move';
    e.stopPropagation();
}

function handleNoteDragStart(e) {
    draggedItem = e.target.closest('.note-card').dataset.noteId;
    draggedType = 'note';
    e.dataTransfer.effectAllowed = 'move';
}

function handleDragOver(e) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    
    const target = e.currentTarget;
    if (!target.classList.contains('folder-item')) return;

    const rect = target.getBoundingClientRect();
    const y = e.clientY - rect.top;
    
    // Reset classes
    target.classList.remove('drag-before', 'drag-after', 'drag-over');

    // Only allow nesting for Folders if not dragging a folder into its own subtree
    // For simplicity, we define regions: Top 25% (before), Bottom 25% (after), Middle 50% (inside)
    if (y < rect.height * 0.25) {
        dropAction = 'before';
        target.classList.add('drag-before');
    } else if (y > rect.height * 0.75) {
        dropAction = 'after';
        target.classList.add('drag-after');
    } else {
        dropAction = 'inside';
        target.classList.add('drag-over');
    }
}

function handleDragLeave(e) {
    const target = e.currentTarget;
    target.classList.remove('drag-before', 'drag-after', 'drag-over');
}

async function handleDropToFolder(e, targetFolderId) {
    e.preventDefault();
    e.stopPropagation();
    
    const target = e.currentTarget;
    target.classList.remove('drag-before', 'drag-after', 'drag-over');
    
    if (!draggedItem) return;
    
    if (draggedType === 'folder') {
        if (draggedItem == targetFolderId) return;

        const draggedFolder = folders.find(f => f.id == draggedItem);
        const targetFolder = folders.find(f => f.id == targetFolderId);
        
        let newParentId = targetFolder.parent_id;
        let newPosition = targetFolder.position;

        if (dropAction === 'inside') {
            newParentId = targetFolder.id;
            // Get max position in new parent
            const siblings = folders.filter(f => f.parent_id == newParentId);
            newPosition = siblings.length > 0 ? Math.max(...siblings.map(s => s.position)) + 1 : 0;
        } else if (dropAction === 'after') {
            newPosition += 1;
        }

        // Prevent dropping into its own children
        const isDescendant = (parentId, childId) => {
            const children = folders.filter(f => f.parent_id == parentId);
            if (children.some(c => c.id == childId)) return true;
            return children.some(c => isDescendant(c.id, childId));
        };
        
        if (isDescendant(draggedItem, newParentId)) {
            Swal.fire({ icon: 'error', title: 'Invalid move', text: 'Cannot move a folder into its own subfolder.', toast: true, position: 'top-end', showConfirmButton: false, timer: 3000 });
            return;
        }

        await moveAndReorderFolder(draggedItem, newParentId, newPosition);
        
    } else if (draggedType === 'note') {
        const note = notes.find(n => n.id == draggedItem);
        if (note) {
            await fetch(`/api/notes/${draggedItem}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    title: note.title,
                    content: note.content,
                    task_id: note.task_id,
                    folder_id: targetFolderId,
                    tags: note.tags
                })
            });
            loadNotes();
        }
    }
    
    draggedItem = null;
    draggedType = null;
    dropAction = null;
}

async function handleDropToRoot(e) {
    e.preventDefault();
    const target = e.currentTarget;
    target.classList.remove('drag-over');
    
    if (!draggedItem) return;
    
    if (draggedType === 'folder') {
        // Move to top of root
        await moveAndReorderFolder(draggedItem, null, 0);
    } else if (draggedType === 'note') {
        const note = notes.find(n => n.id == draggedItem);
        await fetch(`/api/notes/${draggedItem}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ...note, folder_id: null })
        });
        loadNotes();
    }
    
    draggedItem = null;
    draggedType = null;
}

async function moveAndReorderFolder(folderId, newParentId, newPosition) {
    // 1. Update the moved folder
    const folder = folders.find(f => f.id == folderId);
    
    // 2. Shift others in the same parent level
    const siblings = folders
        .filter(f => f.parent_id == newParentId && f.id != folderId)
        .sort((a, b) => a.position - b.position);
    
    siblings.splice(newPosition, 0, { id: folderId, isMoved: true });
    
    const updates = siblings.map((s, index) => ({
        id: s.id,
        position: index,
        parent_id: newParentId
    }));

    try {
        await fetch('/api/folders/positions', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(updates)
        });
        loadFolders();
    } catch (error) {
        console.error('Error reordering folders:', error);
    }
}




// Searchable dropdown state
let taskDropdownState = {
    allItems: [],
    filteredItems: [],
    displayedCount: 0,
    itemsPerPage: 10,
    selectedTaskId: null
};

let noteLinkDropdownState = {
    allItems: [],
    filteredItems: [],
    displayedCount: 0,
    itemsPerPage: 10
};

// Initialize task searchable dropdown
function initTaskDropdown() {
    const searchInput = document.getElementById('note-task-search');
    const dropdownList = document.getElementById('task-dropdown-list');

    // Populate all tasks
    taskDropdownState.allItems = tasks.map(task => ({
        id: task.id,
        text: task.title
    }));
    taskDropdownState.filteredItems = [...taskDropdownState.allItems];
    taskDropdownState.displayedCount = 0;

    // Show dropdown on focus
    searchInput.addEventListener('focus', () => {
        taskDropdownState.displayedCount = 0;
        renderTaskDropdown();
        dropdownList.classList.add('active');
    });

    // Search on input
    searchInput.addEventListener('input', (e) => {
        const searchTerm = e.target.value.toLowerCase();
        taskDropdownState.filteredItems = taskDropdownState.allItems.filter(item =>
            item.text.toLowerCase().includes(searchTerm)
        );
        taskDropdownState.displayedCount = 0;
        renderTaskDropdown();
    });

    // Close dropdown on click outside
    document.addEventListener('click', (e) => {
        if (!searchInput.contains(e.target) && !dropdownList.contains(e.target)) {
            dropdownList.classList.remove('active');
        }
    });

    // Infinite scroll
    dropdownList.addEventListener('scroll', () => {
        if (dropdownList.scrollTop + dropdownList.clientHeight >= dropdownList.scrollHeight - 10) {
            loadMoreTaskItems();
        }
    });
}

function renderTaskDropdown() {
    const dropdownList = document.getElementById('task-dropdown-list');
    dropdownList.innerHTML = '';

    // Add "No task" option
    const noTaskItem = document.createElement('div');
    noTaskItem.className = 'searchable-dropdown-item';
    if (!taskDropdownState.selectedTaskId) {
        noTaskItem.classList.add('selected');
    }
    noTaskItem.textContent = 'No task';
    noTaskItem.addEventListener('click', () => selectTask(null, 'No task'));
    dropdownList.appendChild(noTaskItem);

    // Render items
    loadMoreTaskItems();
}

function loadMoreTaskItems() {
    const dropdownList = document.getElementById('task-dropdown-list');
    const start = taskDropdownState.displayedCount;
    const end = Math.min(start + taskDropdownState.itemsPerPage, taskDropdownState.filteredItems.length);

    for (let i = start; i < end; i++) {
        const item = taskDropdownState.filteredItems[i];
        const itemEl = document.createElement('div');
        itemEl.className = 'searchable-dropdown-item';
        if (taskDropdownState.selectedTaskId === item.id) {
            itemEl.classList.add('selected');
        }
        itemEl.textContent = item.text;
        itemEl.addEventListener('click', () => selectTask(item.id, item.text));
        dropdownList.appendChild(itemEl);
    }

    taskDropdownState.displayedCount = end;

    // Show empty message if no results
    if (taskDropdownState.filteredItems.length === 0) {
        const emptyEl = document.createElement('div');
        emptyEl.className = 'searchable-dropdown-empty';
        emptyEl.textContent = 'No tasks found';
        dropdownList.appendChild(emptyEl);
    }
}

function selectTask(taskId, taskText) {
    taskDropdownState.selectedTaskId = taskId;
    document.getElementById('note-task').value = taskId || '';
    document.getElementById('note-task-search').value = taskText;
    document.getElementById('task-dropdown-list').classList.remove('active');
}

// Initialize note link searchable dropdown
function initNoteLinkDropdown(excludeNoteId = null) {
    const searchInput = document.getElementById('note-link-search');
    const dropdownList = document.getElementById('note-link-dropdown-list');

    // Populate all notes except current and already linked
    noteLinkDropdownState.allItems = allNotes
        .filter(note => note.id !== parseInt(excludeNoteId) && !currentNoteLinkedNotes.includes(note.id))
        .map(note => ({
            id: note.id,
            text: note.title
        }));
    noteLinkDropdownState.filteredItems = [...noteLinkDropdownState.allItems];
    noteLinkDropdownState.displayedCount = 0;

    // Show dropdown on focus
    searchInput.addEventListener('focus', () => {
        noteLinkDropdownState.displayedCount = 0;
        renderNoteLinkDropdown();
        dropdownList.classList.add('active');
    });

    // Search on input
    searchInput.addEventListener('input', (e) => {
        const searchTerm = e.target.value.toLowerCase();
        noteLinkDropdownState.filteredItems = noteLinkDropdownState.allItems.filter(item =>
            item.text.toLowerCase().includes(searchTerm)
        );
        noteLinkDropdownState.displayedCount = 0;
        renderNoteLinkDropdown();
    });

    // Close dropdown on click outside
    document.addEventListener('click', (e) => {
        if (!searchInput.contains(e.target) && !dropdownList.contains(e.target)) {
            dropdownList.classList.remove('active');
        }
    });

    // Infinite scroll
    dropdownList.addEventListener('scroll', () => {
        if (dropdownList.scrollTop + dropdownList.clientHeight >= dropdownList.scrollHeight - 10) {
            loadMoreNoteLinkItems();
        }
    });
}

function renderNoteLinkDropdown() {
    const dropdownList = document.getElementById('note-link-dropdown-list');
    dropdownList.innerHTML = '';

    // Update available items (exclude already linked notes)
    noteLinkDropdownState.allItems = allNotes
        .filter(note => {
            const currentNoteId = parseInt(document.getElementById('note-id').value);
            return note.id !== currentNoteId && !currentNoteLinkedNotes.includes(note.id);
        })
        .map(note => ({
            id: note.id,
            text: note.title
        }));

    const searchTerm = document.getElementById('note-link-search').value.toLowerCase();
    noteLinkDropdownState.filteredItems = noteLinkDropdownState.allItems.filter(item =>
        item.text.toLowerCase().includes(searchTerm)
    );
    noteLinkDropdownState.displayedCount = 0;

    loadMoreNoteLinkItems();
}

function loadMoreNoteLinkItems() {
    const dropdownList = document.getElementById('note-link-dropdown-list');
    const start = noteLinkDropdownState.displayedCount;
    const end = Math.min(start + noteLinkDropdownState.itemsPerPage, noteLinkDropdownState.filteredItems.length);

    for (let i = start; i < end; i++) {
        const item = noteLinkDropdownState.filteredItems[i];
        const itemEl = document.createElement('div');
        itemEl.className = 'searchable-dropdown-item';
        itemEl.textContent = item.text;
        itemEl.addEventListener('click', () => selectNoteLink(item.id, item.text));
        dropdownList.appendChild(itemEl);
    }

    noteLinkDropdownState.displayedCount = end;

    // Show empty message if no results
    if (noteLinkDropdownState.filteredItems.length === 0) {
        const emptyEl = document.createElement('div');
        emptyEl.className = 'searchable-dropdown-empty';
        emptyEl.textContent = 'No notes found';
        dropdownList.appendChild(emptyEl);
    }
}

function selectNoteLink(noteId, noteText) {
    if (!currentNoteLinkedNotes.includes(noteId)) {
        currentNoteLinkedNotes.push(noteId);
        renderNoteLinks();
        document.getElementById('note-link-search').value = '';
        renderNoteLinkDropdown();
    }
    document.getElementById('note-link-dropdown-list').classList.remove('active');
}

// Load notes from API
async function loadNotes() {
    try {
        const response = await fetch('/api/notes');
        notes = await response.json();
        allNotes = [...notes];
        await loadAllNoteTags();
        filterNotes();
        populateNotesFilters();
    } catch (error) {
        console.error('Error loading notes:', error);
    }
}

// Load all note tags
async function loadAllNoteTags() {
    try {
        const response = await fetch('/api/notes/tags');
        allNoteTags = await response.json();
    } catch (error) {
        console.error('Error loading note tags:', error);
    }
}

// Render notes grid
function renderNotes() {
    const notesList = document.getElementById('notes-list');
    notesList.innerHTML = '';

    if (notes.length === 0) {
        notesList.innerHTML = '<p style="text-align: center; color: var(--text-secondary); padding: 2rem;">No notes found. Create your first note!</p>';
        return;
    }

    notes.forEach(note => {
        const noteCard = document.createElement('div');
        noteCard.className = 'note-card';
        noteCard.draggable = true;
        noteCard.dataset.noteId = note.id;
        noteCard.addEventListener('dragstart', handleNoteDragStart);

        // Parse markdown for preview
        const contentPreview = note.content ?
            (note.content.substring(0, 200) + (note.content.length > 200 ? '...' : '')) :
            'No content';

        // Tags HTML
        const tagsHtml = note.tags && note.tags.length > 0 ?
            note.tags.map(tag => `<span class="note-tag">${tag}</span>`).join('') :
            '';

        noteCard.innerHTML = `
            <div class="note-card-header">
                <h3 class="note-title">${note.title}</h3>
                <div class="note-actions">
                    <button onclick="viewNote(${note.id})" class="btn-icon" title="View">👁️</button>
                    <button onclick="editNote(${note.id})" class="btn-icon" title="Edit">✏️</button>
                    <button onclick="deleteNote(${note.id})" class="btn-icon" title="Delete">🗑️</button>
                </div>
            </div>
            <div class="note-content-preview">${contentPreview}</div>
            ${tagsHtml ? `<div class="note-tags">${tagsHtml}</div>` : ''}
            <div class="note-meta">
                <span>📅 ${formatNoteDate(note.updated_at || note.created_at)}</span>
                ${note.attachment_count > 0 ? `<span>📎 ${note.attachment_count}</span>` : ''}
                ${note.task_id ? `<span>🔗 Task</span>` : ''}
            </div>
        `;

        notesList.appendChild(noteCard);
    });
}

// Filter notes
function filterNotes() {
    const searchTerm = document.getElementById('notes-search').value.toLowerCase();
    const taskFilter = document.getElementById('notes-task-filter').value;
    const tagInput = document.getElementById('notes-filter-tag-input')?.value.toLowerCase().trim() || '';

    notes = allNotes.filter(note => {
        // Folder Filter
        let matchesFolder = true;
        if (currentFolderId === null) {
            matchesFolder = true; // All Notes
        } else if (currentFolderId === 'uncategorized') {
            matchesFolder = !note.folder_id;
        } else {
            matchesFolder = note.folder_id === currentFolderId;
        }
        
        if (!matchesFolder) return false;

        const matchesSearch = !searchTerm ||
            note.title.toLowerCase().includes(searchTerm) ||
            (note.content && note.content.toLowerCase().includes(searchTerm));

        // Filter by tags (space separated input)
        let matchesTags = true;
        if (tagInput) {
            const searchTags = tagInput.split(/\s+/);
            if (!note.tags || note.tags.length === 0) {
                matchesTags = false;
            } else {
                const noteTagsLower = note.tags.map(t => t.toLowerCase());
                matchesTags = searchTags.every(searchTag => 
                    noteTagsLower.some(noteTag => noteTag.includes(searchTag))
                );
            }
        }

        const matchesTask = !taskFilter ||
            (taskFilter === 'no-task' && !note.task_id) ||
            (note.task_id && note.task_id.toString() === taskFilter);

        return matchesSearch && matchesTags && matchesTask;
    });

    renderNotes();
}

// Populate notes filters
function populateNotesFilters() {
    // Populate task filter
    const taskFilter = document.getElementById('notes-task-filter');
    taskFilter.innerHTML = '<option value="">All Tasks</option><option value="no-task">No Task</option>';

    tasks.forEach(task => {
        const option = document.createElement('option');
        option.value = task.id;
        option.textContent = task.title;
        taskFilter.appendChild(option);
    });
}

// Note tag input functions
function handleNoteTagInput(event) {
    if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        const input = event.target;
        const tag = input.value.trim();

        if (tag && !noteSelectedTags.includes(tag)) {
            noteSelectedTags.push(tag);
            renderNoteTags();
            input.value = '';
            hideNoteTagSuggestions();
        }
    }
}

function showNoteTagSuggestions(event) {
    const input = event.target;
    const value = input.value.trim().toLowerCase();
    const suggestionsContainer = document.getElementById('note-tag-suggestions');

    if (!value) {
        suggestionsContainer.classList.remove('active');
        return;
    }

    const suggestions = allNoteTags.filter(tag =>
        tag.toLowerCase().includes(value) &&
        !noteSelectedTags.includes(tag)
    );

    if (suggestions.length === 0) {
        suggestionsContainer.classList.remove('active');
        return;
    }

    suggestionsContainer.innerHTML = suggestions.map(tag =>
        `<div class="tag-suggestion-item" onclick="selectNoteTag('${tag}')">${tag}</div>`
    ).join('');
    suggestionsContainer.classList.add('active');
}

function hideNoteTagSuggestions() {
    const suggestionsContainer = document.getElementById('note-tag-suggestions');
    suggestionsContainer.classList.remove('active');
}

function selectNoteTag(tag) {
    if (!noteSelectedTags.includes(tag)) {
        noteSelectedTags.push(tag);
        renderNoteTags();
    }
    document.getElementById('note-tag-input').value = '';
    hideNoteTagSuggestions();
}

function renderNoteTags() {
    const container = document.getElementById('note-selected-tags');
    if (!container) return;

    container.innerHTML = '';
    noteSelectedTags.forEach(tag => {
        const tagEl = document.createElement('div');
        tagEl.className = 'tag-item';
        tagEl.innerHTML = `
            <span>${tag}</span>
            <span class="tag-remove" onclick="removeNoteTag('${tag}')">&times;</span>
        `;
        container.appendChild(tagEl);
    });

    // Update hidden input
    document.getElementById('note-tags').value = JSON.stringify(noteSelectedTags);
}

function removeNoteTag(tag) {
    noteSelectedTags = noteSelectedTags.filter(t => t !== tag);
    renderNoteTags();
}

// Open add note modal
async function openAddNoteModal() {
    document.getElementById('note-modal-title').textContent = 'Add New Note';
    document.getElementById('note-form').reset();
    document.getElementById('note-id').value = '';
    document.getElementById('version-history-section').style.display = 'none';
    document.getElementById('note-attachments-list').innerHTML = '';
    document.getElementById('note-links-container').innerHTML = '';
    currentNoteLinkedNotes = [];

    // Reset task dropdown
    document.getElementById('note-task').value = '';
    document.getElementById('note-task-search').value = '';
    taskDropdownState.selectedTaskId = null;

    // Reset note link search
    document.getElementById('note-link-search').value = '';

    // Reset tags
    noteSelectedTags = [];
    renderNoteTags();

    // Initialize dropdowns
    initTaskDropdown();
    initNoteLinkDropdown();
    updateFolderSelects();

    // Pre-select current folder
    if (currentFolderId && currentFolderId !== 'uncategorized') {
        document.getElementById('note-folder').value = currentFolderId;
    } else {
        document.getElementById('note-folder').value = '';
    }

    document.getElementById('note-modal').style.display = 'block';
}

// View note (read-only with markdown rendered)
async function viewNote(noteId) {
    try {
        const response = await fetch(`/api/notes/${noteId}`);
        const note = await response.json();

        // Render markdown with syntax highlighting
        const renderedContent = marked.parse(note.content || 'No content available');

        // Apply syntax highlighting to any code blocks that weren't highlighted
        setTimeout(() => {
            document.querySelectorAll('.swal2-container pre code:not(.hljs)').forEach((block) => {
                hljs.highlightElement(block);
            });
        }, 50);

        // Format attachments
        const attachmentsHtml = note.attachments && note.attachments.length > 0 ?
            `<div style="margin-top: 1rem;">
                <strong>Attachments:</strong><br>
                ${note.attachments.map(att =>
                    `<a href="/${att.filepath}" target="_blank" style="color: var(--accent);">📎 ${att.filename}</a>`
                ).join('<br>')}
            </div>` : '';

        // Format linked notes
        const linkedNotesHtml = note.linked_notes && note.linked_notes.length > 0 ?
            `<div style="margin-top: 1rem;">
                <strong>Linked Notes:</strong><br>
                ${note.linked_notes.map(ln =>
                    `<a href="#" onclick="viewNote(${ln.id}); return false;" style="color: var(--accent);">🔗 ${ln.title}</a>`
                ).join('<br>')}
            </div>` : '';

        Swal.fire({
            title: note.title,
            html: `
                ${note.tags && note.tags.length > 0 ? `<div style="margin-bottom: 1rem;">${note.tags.map(tag => `<span style="background: var(--accent); color: white; padding: 2px 8px; border-radius: 4px; font-size: 12px; margin-right: 5px;">${tag}</span>`).join('')}</div>` : ''}
                <div class="markdown-content" style="text-align: left; max-height: 60vh; overflow-y: auto; padding: 1rem; background: var(--bg-tertiary); border-radius: 8px;">
                    ${renderedContent}
                </div>
                ${attachmentsHtml}
                ${linkedNotesHtml}
                <div style="margin-top: 1rem; font-size: 12px; color: var(--text-secondary);">
                    Created: ${formatNoteDate(note.created_at)} | Updated: ${formatNoteDate(note.updated_at)}
                </div>
            `,
            width: '800px',
            showCancelButton: true,
            confirmButtonText: 'Edit',
            cancelButtonText: 'Close',
            confirmButtonColor: '#6366f1',
            background: 'var(--bg-secondary)',
            color: 'var(--text-primary)',
        }).then((result) => {
            if (result.isConfirmed) {
                editNote(noteId);
            }
        });

    } catch (error) {
        console.error('Error viewing note:', error);
        Swal.fire('Error', 'Failed to load note', 'error');
    }
}

// Edit note
async function editNote(noteId) {
    try {
        const response = await fetch(`/api/notes/${noteId}`);
        const note = await response.json();

        document.getElementById('note-modal-title').textContent = 'Edit Note';
        document.getElementById('note-id').value = note.id;
        document.getElementById('note-title').value = note.title;
        document.getElementById('note-content').value = note.content || '';
        
        // Populate Folder
        updateFolderSelects(); // Ensure options are fresh
        document.getElementById('note-folder').value = note.folder_id || '';

        // Set tags
        noteSelectedTags = note.tags || [];
        renderNoteTags();

        document.getElementById('note-task').value = note.task_id || '';

        // Set task dropdown
        const selectedTask = tasks.find(t => t.id === note.task_id);
        taskDropdownState.selectedTaskId = note.task_id || null;
        document.getElementById('note-task-search').value = selectedTask ? selectedTask.title : '';

        // Populate note links
        currentNoteLinkedNotes = note.linked_notes ? note.linked_notes.map(ln => ln.id) : [];
        renderNoteLinks();
        document.getElementById('note-link-search').value = '';

        // Initialize dropdowns
        initTaskDropdown();
        initNoteLinkDropdown(noteId);

        // Show attachments
        const attachmentsList = document.getElementById('note-attachments-list');
        attachmentsList.innerHTML = '';
        if (note.attachments && note.attachments.length > 0) {
            note.attachments.forEach(att => {
                const attDiv = document.createElement('div');
                attDiv.className = 'attachment-item';
                attDiv.innerHTML = `
                    <span>📎 ${att.filename} (${formatFileSize(att.file_size)})</span>
                    <button type="button" onclick="deleteAttachment(${note.id}, ${att.id})" class="btn-delete-small">×</button>
                `;
                attachmentsList.appendChild(attDiv);
            });
        }

        // Load version history
        await loadVersionHistory(noteId);

        document.getElementById('note-modal').style.display = 'block';
    } catch (error) {
        console.error('Error loading note:', error);
        Swal.fire('Error', 'Failed to load note', 'error');
    }
}

// Save note (create or update)
async function saveNote(event) {
    event.preventDefault();

    const noteId = document.getElementById('note-id').value;
    const noteData = {
        title: document.getElementById('note-title').value,
        content: document.getElementById('note-content').value,
        task_id: document.getElementById('note-task').value || null,
        folder_id: document.getElementById('note-folder').value || null,
        tags: noteSelectedTags,
        linked_note_ids: currentNoteLinkedNotes
    };

    try {
        let response;
        if (noteId) {
            response = await fetch(`/api/notes/${noteId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(noteData)
            });
        } else {
            response = await fetch('/api/notes', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(noteData)
            });
        }

        if (response.ok) {
            const result = await response.json();
            const savedNoteId = noteId || result.id;

            // Handle file uploads
            const fileInput = document.getElementById('note-attachment');
            if (fileInput.files.length > 0) {
                await uploadAttachments(savedNoteId, fileInput.files);
            }

            await loadNotes();
            closeNoteModal();

            Swal.fire({
                icon: 'success',
                title: noteId ? 'Note Updated!' : 'Note Created!',
                toast: true,
                position: 'top-end',
                showConfirmButton: false,
                timer: 2000,
                timerProgressBar: true
            });
        }
    } catch (error) {
        console.error('Error saving note:', error);
        Swal.fire('Error', 'Failed to save note', 'error');
    }
}

// Upload attachments
async function uploadAttachments(noteId, files) {
    for (const file of files) {
        const formData = new FormData();
        formData.append('file', file);

        try {
            await fetch(`/api/notes/${noteId}/attachments`, {
                method: 'POST',
                body: formData
            });
        } catch (error) {
            console.error('Error uploading attachment:', error);
        }
    }
}

// Delete attachment
async function deleteAttachment(noteId, attachmentId) {
    const result = await Swal.fire({
        title: 'Delete Attachment?',
        text: 'This action cannot be undone!',
        icon: 'warning',
        showCancelButton: true,
        confirmButtonColor: '#ef4444',
        confirmButtonText: 'Delete'
    });

    if (result.isConfirmed) {
        try {
            const response = await fetch(`/api/notes/${noteId}/attachments/${attachmentId}`, {
                method: 'DELETE'
            });

            if (response.ok) {
                editNote(noteId); // Reload the modal
                Swal.fire({
                    icon: 'success',
                    title: 'Attachment Deleted!',
                    toast: true,
                    position: 'top-end',
                    showConfirmButton: false,
                    timer: 2000
                });
            }
        } catch (error) {
            console.error('Error deleting attachment:', error);
            Swal.fire('Error', 'Failed to delete attachment', 'error');
        }
    }
}

// Delete note
async function deleteNote(noteId) {
    const result = await Swal.fire({
        title: 'Delete Note?',
        text: 'This will delete the note and all its attachments. This action cannot be undone!',
        icon: 'warning',
        showCancelButton: true,
        confirmButtonColor: '#ef4444',
        confirmButtonText: 'Delete'
    });

    if (result.isConfirmed) {
        try {
            const response = await fetch(`/api/notes/${noteId}`, {
                method: 'DELETE'
            });

            if (response.ok) {
                await loadNotes();
                Swal.fire({
                    icon: 'success',
                    title: 'Note Deleted!',
                    toast: true,
                    position: 'top-end',
                    showConfirmButton: false,
                    timer: 2000
                });
            }
        } catch (error) {
            console.error('Error deleting note:', error);
            Swal.fire('Error', 'Failed to delete note', 'error');
        }
    }
}

// Close note modal
function closeNoteModal() {
    document.getElementById('note-modal').style.display = 'none';
    document.getElementById('note-preview').style.display = 'none';
    document.getElementById('note-content').style.display = 'block';
    document.getElementById('preview-toggle').textContent = 'Preview';
}

// Markdown editor toolbar functions
function insertMarkdown(before, after) {
    const textarea = document.getElementById('note-content');
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const selectedText = textarea.value.substring(start, end);
    const replacement = before + selectedText + after;

    textarea.value = textarea.value.substring(0, start) + replacement + textarea.value.substring(end);
    textarea.focus();
    textarea.setSelectionRange(start + before.length, start + before.length + selectedText.length);
}

// Toggle markdown preview
function togglePreview() {
    const textarea = document.getElementById('note-content');
    const preview = document.getElementById('note-preview');
    const toggleBtn = document.getElementById('preview-toggle');

    if (preview.style.display === 'none') {
        // Show preview
        const content = textarea.value.trim() || 'Nothing to preview...';
        const renderedContent = marked.parse(content);
        preview.innerHTML = renderedContent;
        preview.style.display = 'block';
        textarea.style.display = 'none';
        toggleBtn.textContent = 'Edit';

        // Apply syntax highlighting to code blocks that weren't auto-highlighted
        setTimeout(() => {
            preview.querySelectorAll('pre code:not(.hljs)').forEach((block) => {
                hljs.highlightElement(block);
            });
        }, 10);
    } else {
        // Show editor
        preview.style.display = 'none';
        textarea.style.display = 'block';
        toggleBtn.textContent = 'Preview';
    }
}

// Internal linking functions
function removeNoteLink(noteId) {
    currentNoteLinkedNotes = currentNoteLinkedNotes.filter(id => id !== noteId);
    renderNoteLinks();
    renderNoteLinkDropdown(); // Refresh dropdown to show removed note
}

function renderNoteLinks() {
    const container = document.getElementById('note-links-container');
    container.innerHTML = '';

    currentNoteLinkedNotes.forEach(noteId => {
        const note = allNotes.find(n => n.id === noteId);
        if (note) {
            const linkDiv = document.createElement('div');
            linkDiv.className = 'note-link-item';
            linkDiv.innerHTML = `
                <span>🔗 ${note.title}</span>
                <button type="button" onclick="removeNoteLink(${noteId})" class="btn-delete-small">×</button>
            `;
            container.appendChild(linkDiv);
        }
    });
}

// Version history functions
async function loadVersionHistory(noteId) {
    try {
        const response = await fetch(`/api/notes/${noteId}/versions`);
        const versions = await response.json();

        const versionList = document.getElementById('version-history-list');
        versionList.innerHTML = '';

        if (versions.length > 0) {
            document.getElementById('version-history-section').style.display = 'block';

            versions.forEach(version => {
                const versionDiv = document.createElement('div');
                versionDiv.className = 'version-item';
                versionDiv.innerHTML = `
                    <div>
                        <strong>Version ${version.version_number}</strong> - ${formatNoteDate(version.created_at)}
                        <br><small>${version.title}</small>
                    </div>
                    <button type="button" onclick="restoreVersion(${noteId}, ${version.version_number})" class="btn-restore">Restore</button>
                `;
                versionList.appendChild(versionDiv);
            });
        }
    } catch (error) {
        console.error('Error loading version history:', error);
    }
}

async function restoreVersion(noteId, versionNumber) {
    const result = await Swal.fire({
        title: 'Restore Version?',
        text: `This will restore version ${versionNumber}. Current content will be saved as a new version.`,
        icon: 'question',
        showCancelButton: true,
        confirmButtonText: 'Restore'
    });

    if (result.isConfirmed) {
        try {
            const response = await fetch(`/api/notes/${noteId}/restore-version/${versionNumber}`, {
                method: 'POST'
            });

            if (response.ok) {
                closeNoteModal();
                await loadNotes();
                Swal.fire({
                    icon: 'success',
                    title: 'Version Restored!',
                    toast: true,
                    position: 'top-end',
                    showConfirmButton: false,
                    timer: 2000
                });
            }
        } catch (error) {
            console.error('Error restoring version:', error);
            Swal.fire('Error', 'Failed to restore version', 'error');
        }
    }
}

// Utility functions
function formatNoteDate(dateString) {
    if (!dateString) return 'N/A';
    const date = new Date(dateString);
    return date.toLocaleDateString('id-ID', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    });
}

function formatFileSize(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
}

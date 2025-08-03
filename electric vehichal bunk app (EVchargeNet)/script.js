// script.js
// Electric Vehicle Charging Station Management App (Firebase Fully Integrated & Corrected)

// --- Simple Logger ---
const log = {
    info: (message, data = '') => console.log(`[INFO] ${new Date().toISOString()}: ${message}`, data),
    warn: (message, data = '') => console.warn(`[WARN] ${new Date().toISOString()}: ${message}`, data),
    error: (message, data = '') => console.error(`[ERROR] ${new Date().toISOString()}: ${message}`, data),
};

// --- Firebase Initialization ---

firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();
const auth = firebase.auth();

document.addEventListener('DOMContentLoaded', () => {
    log.info('DOM fully loaded and parsed.');

    // --- DATA MANAGEMENT & STATE (Now from Firestore) ---
    let stations = [];
    let userProfile = {};
    let bookings = [];
    let reviews = [];
    let activeSessions = [];
    let filterState = JSON.parse(localStorage.getItem('ev_filterState')) || {}; // Keep UI filters local

    let loggedInUser = null; // Will be the Firebase user object
    let map;
    let markers = {};
    let charts = {};
    let sessionInterval;
    let stationsUnsubscribe = null; // To detach Firestore listener

    const evModels = {
        'Tata Nexon EV': { compatible: ['CCS', 'Type 2'], battery: 40.5 },
        'MG ZS EV': { compatible: ['CCS'], battery: 50.3 },
        'Hyundai Kona Electric': { compatible: ['CCS'], battery: 39.2 },
        'Tata Tigor EV': { compatible: ['CCS'], battery: 26 },
        'Other': { compatible: ['Type 2', 'CCS', 'CHAdeMO'], battery: 50 }
    };

    // --- UI ELEMENT SELECTORS ---
    const authScreen = document.getElementById('auth-screen');
    const userAppContainer = document.getElementById('user-app');
    const adminAppContainer = document.getElementById('admin-app');

    // --- UTILITY FUNCTIONS (Defined early to prevent reference errors) ---
    function applyTheme() {
        if (userProfile.theme === 'dark') {
            document.documentElement.classList.add('dark');
        } else {
            document.documentElement.classList.remove('dark');
        }
    }
    
    function showToast(message, type = 'info') {
        const toast = document.getElementById('toast');
        toast.textContent = message;
        toast.className = 'toast show';
        if (type === 'success') toast.style.backgroundColor = 'var(--green)';
        else if (type === 'error') toast.style.backgroundColor = 'var(--red)';
        else toast.style.backgroundColor = '#333';
        setTimeout(() => { toast.className = 'toast'; }, 3000);
    }

    // --- DATA FETCHING from FIRESTORE ---
    function fetchAndListenForStations() {
        if (stationsUnsubscribe) stationsUnsubscribe();

        stationsUnsubscribe = db.collection('stations').onSnapshot(snapshot => {
            stations = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            log.info('Real-time station data updated from Firestore.');
            const activePage = document.querySelector('.nav-link.active, .admin-nav-link.active')?.dataset.page;
            if (activePage === 'station-list') renderStationList();
            if (activePage === 'map-view') updateMarkers();
            if (activePage === 'admin-stations') renderAdminStations(document.getElementById('admin-main-content'));
        }, err => {
            log.error('Error listening to station data:', err);
            showToast('Could not load station data in real-time.', 'error');
        });
    }

    async function fetchUserData() {
        if (!loggedInUser) return;
        try {
            const bookingsSnapshot = await db.collection('bookings').where('userId', '==', loggedInUser.uid).get();
            let userBookings = bookingsSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            bookings = userBookings.sort((a, b) => (b.createdAt?.toMillis() || 0) - (a.createdAt?.toMillis() || 0));

            const reviewsSnapshot = await db.collection('reviews').orderBy('createdAt', 'desc').get();
            reviews = reviewsSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

            const activeSessionsSnapshot = await db.collection('activeSessions').where('userId', '==', loggedInUser.uid).get();
            activeSessions = activeSessionsSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            log.info('User-specific data fetched successfully.');
        } catch (error) {
            log.error('Error fetching user data:', error);
        }
    }

    // --- AUTHENTICATION & VALIDATION ---
    function handleLogin(e) {
        e.preventDefault();
        const email = document.getElementById('login-username').value;
        const password = document.getElementById('login-password').value;
        auth.signInWithEmailAndPassword(email, password)
            .catch(error => {
                log.warn(`Failed login attempt for email: '${email}'.`, error);
                showToast(error.message, 'error');
            });
    }

    function handleRegister(e) {
        e.preventDefault();
        document.getElementById('register-username-error').textContent = '';
        document.getElementById('register-password-error').textContent = '';
        const email = document.getElementById('register-username').value;
        const password = document.getElementById('register-password').value;
        const role = document.getElementById('role-select').value;
        if (password.length < 6) {
            document.getElementById('register-password-error').textContent = 'Password must be at least 6 characters.';
            return;
        }
        auth.createUserWithEmailAndPassword(email, password)
            .then(userCredential => {
                const user = userCredential.user;
                log.info(`New user registered: '${user.email}' with role: '${role}'.`);
                return db.collection('users').doc(user.uid).set({
                    email: user.email,
                    role: role,
                    profile: { favorites: [], vehicle: 'Other', theme: 'light', loyaltyPoints: 0, hasCompletedTour: false }
                });
            })
            .then(() => {
                showToast('Registration successful! Please log in.', 'success');
                document.getElementById('register-form').reset();
                switchAuthTab('login');
            })
            .catch(error => {
                log.warn('User registration failed.', { email, role, error });
                document.getElementById('register-username-error').textContent = error.message;
            });
    }

    function handleLogout() {
        auth.signOut().then(() => {
            log.info('User logged out.');
            if (stationsUnsubscribe) {
                stationsUnsubscribe();
                stationsUnsubscribe = null;
            }
             clearInterval(sessionInterval);
        });
    }
    
    function showAppView() {
        authScreen.classList.toggle('hidden', loggedInUser !== null);
        userAppContainer.classList.toggle('hidden', loggedInUser?.role !== 'user');
        adminAppContainer.classList.toggle('hidden', loggedInUser?.role !== 'admin');
        if (loggedInUser?.role === 'user') {
            log.info(`Showing user view for ${loggedInUser.username}`);
            applyTheme();
            initUserApp();
        } else if (loggedInUser?.role === 'admin') {
            log.info(`Showing admin view for ${loggedInUser.username}`);
            document.documentElement.classList.add('dark');
            initAdminApp();
        } else {
            log.info('No user logged in, showing auth screen.');
            document.documentElement.classList.remove('dark');
        }
    }

    auth.onAuthStateChanged(async (user) => {
        if (user) {
            loggedInUser = user;
            const userDoc = await db.collection('users').doc(user.uid).get();
            if (userDoc.exists) {
                const userData = userDoc.data();
                loggedInUser.role = userData.role;
                loggedInUser.username = userData.email;
                userProfile = userData.profile || { favorites: [], vehicle: 'Other', theme: 'light', loyaltyPoints: 0, hasCompletedTour: false };
                fetchAndListenForStations();
                await fetchUserData();
                showAppView();
            } else {
                log.error("User document not found in Firestore for UID:", user.uid);
                handleLogout();
            }
        } else {
            loggedInUser = null;
            userProfile = {};
            stations = [];
            bookings = [];
            reviews = [];
            activeSessions = [];
            showAppView();
        }
    });

    function switchAuthTab(tabName) {
        document.getElementById('login-tab').classList.toggle('active', tabName === 'login');
        document.getElementById('register-tab').classList.toggle('active', tabName !== 'login');
        document.getElementById('login-form-container').classList.toggle('hidden', tabName !== 'login');
        document.getElementById('register-form-container').classList.toggle('hidden', tabName === 'login');
    }
    
    // --- USER APP ---
    function initUserApp() {
        userAppContainer.innerHTML = `
            <div class="flex flex-col md:flex-row h-screen">
                <nav class="bg-white dark:bg-gray-800 shadow-lg md:w-64 flex-shrink-0 z-30 transition-colors duration-300 flex flex-col">
                    <div class="p-4 border-b border-gray-200 dark:border-gray-700">
                        <h1 class="text-2xl font-bold text-indigo-600 dark:text-indigo-400"><i class="fas fa-charging-station mr-2"></i>EV ChargeNet</h1>
                        <div class="mt-4 text-sm text-gray-600 dark:text-gray-400">
                            <p>Welcome, <span class="font-semibold">${loggedInUser.username}</span>!</p>
                            <p id="live-clock" class="font-mono text-xs mt-1"></p>
                        </div>
                    </div>
                    <ul class="mt-2 flex-grow p-2">
                        <li><a href="#" class="nav-link text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 p-3 rounded-md flex items-center mb-1" data-page="map-view" id="tour-step-1"><i class="fas fa-map-marked-alt w-6 mr-3 text-center"></i>Map View</a></li>
                        <li><a href="#" class="nav-link text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 p-3 rounded-md flex items-center mb-1" data-page="station-list" id="tour-step-2"><i class="fas fa-list-ul w-6 mr-3 text-center"></i>Station List</a></li>
                        <li><a href="#" class="nav-link text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 p-3 rounded-md flex items-center mb-1" data-page="trip-planner"><i class="fas fa-route w-6 mr-3 text-center"></i>Trip Planner</a></li>
                        <li><a href="#" class="nav-link text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 p-3 rounded-md flex items-center mb-1" data-page="my-sessions"><i class="fas fa-bolt w-6 mr-3 text-center"></i>My Sessions</a></li>
                        <li><a href="#" class="nav-link text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 p-3 rounded-md flex items-center" data-page="profile" id="tour-step-3"><i class="fas fa-user-circle w-6 mr-3 text-center"></i>Profile</a></li>
                    </ul>
                    <div class="p-4 border-t border-gray-200 dark:border-gray-700">
                        <div class="theme-switch-wrapper mb-4">
                            <label class="theme-switch" for="theme-checkbox-user">
                                <input type="checkbox" id="theme-checkbox-user" ${userProfile.theme === 'dark' ? 'checked' : ''} />
                                <div class="slider-theme"></div>
                            </label>
                            <span class="ml-3 text-sm font-medium">Mode</span>
                        </div>
                        <button id="logout-btn-user" class="w-full text-left p-3 rounded-md hover:bg-red-50 dark:hover:bg-red-900/50 text-red-600 dark:text-red-400 transition-colors duration-300"><i class="fas fa-sign-out-alt w-6 mr-3"></i>Logout</button>
                    </div>
                </nav>
                <main id="user-main-content" class="flex-1 p-4 md:p-6 lg:p-8 overflow-y-auto bg-gray-50 dark:bg-gray-900 z-10 transition-colors duration-300"></main>
            </div>`;

        document.getElementById('logout-btn-user').addEventListener('click', handleLogout);
        document.getElementById('theme-checkbox-user').addEventListener('change', toggleTheme);
        userAppContainer.querySelectorAll('.nav-link').forEach(link => link.addEventListener('click', (e) => {
            e.preventDefault();
            showUserPage(e.currentTarget.dataset.page);
        }));

        updateClock();
        setInterval(updateClock, 1000);
        showUserPage('map-view');

        if (!userProfile.hasCompletedTour) {
            setTimeout(startOnboardingTour, 500);
        }
    }

    function showUserPage(pageId) {
        log.info(`User '${loggedInUser.username}' navigated to page: '${pageId}'.`);
        const container = document.getElementById('user-main-content');
        if (!container) return;
        container.innerHTML = '';
        userAppContainer.querySelectorAll('.nav-link').forEach(l => l.classList.remove('active'));
        userAppContainer.querySelector(`.nav-link[data-page="${pageId}"]`).classList.add('active');
        const pageRenderers = {
            'map-view': renderMapView,
            'station-list': renderStationListView,
            'trip-planner': renderTripPlannerView,
            'my-sessions': renderMySessionsView,
            'profile': renderProfileView,
        };
        if(pageRenderers[pageId]) {
            pageRenderers[pageId](container);
        }
    }
    
    // --- ADMIN APP ---
    function initAdminApp() {
        adminAppContainer.innerHTML = `
            <div class="flex flex-col md:flex-row h-screen bg-gray-800 text-gray-200">
                 <nav class="bg-gray-900 shadow-lg md:w-64 flex-shrink-0">
                    <div class="p-6">
                        <h1 class="text-2xl font-bold text-white"><i class="fas fa-user-shield mr-2"></i>Admin Panel</h1>
                        <p class="text-sm text-gray-400">Welcome, <span class="font-semibold">${loggedInUser.username}</span></p>
                    </div>
                    <ul class="mt-2 p-2">
                        <li><a href="#" class="admin-nav-link p-3 flex items-center rounded-md mb-1" data-page="admin-dashboard"><i class="fas fa-tachometer-alt w-6 mr-3"></i>Dashboard</a></li>
                        <li><a href="#" class="admin-nav-link p-3 flex items-center rounded-md mb-1" data-page="admin-stations"><i class="fas fa-sitemap w-6 mr-3"></i>Station Management</a></li>
                        <li><a href="#" class="admin-nav-link p-3 flex items-center rounded-md mb-1" data-page="admin-reviews"><i class="fas fa-star-half-alt w-6 mr-3"></i>Review Moderation</a></li>
                    </ul>
                    <div class="p-4 mt-auto border-t border-gray-700">
                        <button id="logout-btn-admin" class="w-full text-left p-3 rounded-md hover:bg-red-900/50 text-red-400"><i class="fas fa-sign-out-alt w-6 mr-3"></i>Logout</button>
                    </div>
                </nav>
                <main id="admin-main-content" class="flex-1 p-4 md:p-8 overflow-y-auto bg-gray-800"></main>
            </div>`;
        document.getElementById('logout-btn-admin').addEventListener('click', handleLogout);
        adminAppContainer.querySelectorAll('.admin-nav-link').forEach(link => link.addEventListener('click', (e) => {
            e.preventDefault();
            showAdminPage(e.currentTarget.dataset.page);
        }));
        showAdminPage('admin-dashboard');
    }

    function showAdminPage(pageId) {
        log.info(`Admin '${loggedInUser.username}' navigated to page: '${pageId}'.`);
        const container = document.getElementById('admin-main-content');
        if (!container) return;
        container.innerHTML = '';

        adminAppContainer.querySelectorAll('.admin-nav-link').forEach(l => l.classList.remove('active'));
        adminAppContainer.querySelector(`.admin-nav-link[data-page="${pageId}"]`).classList.add('active');

        const pageRenderers = {
            'admin-dashboard': renderAdminDashboard,
            'admin-stations': renderAdminStations,
            'admin-reviews': renderAdminReviews,
        };

        if(pageRenderers[pageId]) {
            pageRenderers[pageId](container);
        }
    }
    
    // --- THEME & PROFILE UPDATES ---
    async function toggleTheme() {
        document.documentElement.classList.toggle('dark');
        userProfile.theme = document.documentElement.classList.contains('dark') ? 'dark' : 'light';
        try {
            await db.collection('users').doc(loggedInUser.uid).update({ 'profile.theme': userProfile.theme });
            log.info(`Theme changed to ${userProfile.theme} for user: ${loggedInUser.username}`);
        } catch (error) {
            log.error("Error updating theme:", error);
        }
    }
    
    async function updateUserProfile() {
        try {
            await db.collection('users').doc(loggedInUser.uid).update({ profile: userProfile });
            log.info("User profile updated in Firestore.");
        } catch (error) {
            log.error("Error updating user profile:", error);
        }
    }

    // --- PAGE RENDERERS ---
    function renderFilterBar(container) {
        container.innerHTML += `
            <div id="filter-bar" class="mb-6 p-4 bg-white dark:bg-gray-800 rounded-lg shadow-md">
                <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 items-end">
                    <div><label for="search-input" class="block text-sm font-medium mb-1">Search by Name</label><input type="text" id="search-input" placeholder="e.g. Green Park" class="block w-full rounded-md border-gray-300 dark:border-gray-600 dark:bg-gray-700 shadow-sm focus:ring-indigo-500 focus:border-indigo-500" value="${filterState.searchTerm || ''}"></div>
                    <div><label for="charger-type-filter" class="block text-sm font-medium mb-1">Charger Type</label><select id="charger-type-filter" class="block w-full rounded-md border-gray-300 dark:border-gray-600 dark:bg-gray-700 shadow-sm focus:ring-indigo-500 focus:border-indigo-500"><option value="">All Types</option><option>Type 2</option><option>CCS</option><option>CHAdeMO</option></select></div>
                    <div><label for="amenities-filter" class="block text-sm font-medium mb-1">Amenities</label><select id="amenities-filter" class="block w-full rounded-md border-gray-300 dark:border-gray-600 dark:bg-gray-700 shadow-sm focus:ring-indigo-500 focus:border-indigo-500"><option value="">Any</option><option>Cafe</option><option>WiFi</option><option>Restroom</option><option>Lounge</option></select></div>
                    <div class="flex items-center"><input id="available-only-checkbox" type="checkbox" class="h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500" ${filterState.availableOnly ? 'checked' : ''}><label for="available-only-checkbox" class="ml-2 block text-sm">Show Available Only</label></div>
                </div>
            </div>`;
        // Set initial values after rendering
        document.getElementById('charger-type-filter').value = filterState.chargerType || '';
        document.getElementById('amenities-filter').value = filterState.amenity || '';
    }

    function renderMapView(container) {
        container.innerHTML = `<h2 class="text-3xl font-bold mb-4">Charging Stations Map</h2>`;
        renderFilterBar(container);
        container.innerHTML += `<div id="map" class="h-[calc(100vh-220px)] rounded-lg shadow-lg"></div>`;
        setTimeout(initMap, 10);
    }

    function renderStationListView(container) {
        container.innerHTML = `<h2 class="text-3xl font-bold mb-4">Available Stations</h2>`;
        renderFilterBar(container);
        container.innerHTML += `<div id="station-list-container" class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6"></div>`;
        renderStationList();
    }
    
    function renderMySessionsView(container) {
        const activeSession = activeSessions.length > 0 ? activeSessions[0] : null;
        let activeSessionHtml = '';
        if (activeSession) {
            const station = stations.find(s => s.id === activeSession.stationId);
            activeSessionHtml = `
                <div class="bg-green-100 dark:bg-green-900/50 border-l-4 border-green-500 p-6 rounded-lg shadow-lg">
                    <h3 class="text-2xl font-bold text-green-800 dark:text-green-300">Active Charging Session</h3>
                    <p class="text-lg font-semibold mt-2">${station?.name || 'Loading...'}</p>
                    <div class="grid grid-cols-3 gap-4 mt-4 text-center">
                        <div>
                            <p class="text-sm text-gray-500 dark:text-gray-400">Time Elapsed</p>
                            <p id="session-timer" class="text-2xl font-mono">00:00:00</p>
                        </div>
                        <div>
                            <p class="text-sm text-gray-500 dark:text-gray-400">Energy Delivered</p>
                            <p id="session-kwh" class="text-2xl font-mono">0.00 kWh</p>
                        </div>
                        <div>
                            <p class="text-sm text-gray-500 dark:text-gray-400">Current Cost</p>
                            <p id="session-cost" class="text-2xl font-mono">₹0.00</p>
                        </div>
                    </div>
                    <button id="stop-charging-btn" class="w-full mt-6 bg-red-600 text-white py-2 rounded-lg hover:bg-red-700" data-id="${activeSession.id}">Stop Charging</button>
                </div>`;
            startSessionTimer(activeSession);
        }

        let bookingsHtml = '<p class="text-gray-500 dark:text-gray-400">You have no past sessions.</p>';
        if (bookings.length > 0) {
            bookingsHtml = bookings.map(booking => {
                const station = stations.find(s => s.id === booking.stationId);
                const date = booking.createdAt?.toDate ? new Date(booking.createdAt.toDate()).toLocaleDateString() : 'N/A';
                const cost = (booking.cost || 0).toFixed(2);
                return `
                <div class="bg-white dark:bg-gray-800 p-4 rounded-lg shadow-md flex justify-between items-center">
                    <div>
                        <p class="font-bold text-lg">${station?.name || 'Unknown Station'}</p>
                        <p class="text-sm text-gray-500 dark:text-gray-400">Completed on ${date}</p>
                        <p class="text-sm text-gray-500 dark:text-gray-400">Duration: ${Math.floor(booking.duration / 60)}m ${booking.duration % 60}s | Cost: ₹${cost}</p>
                    </div>
                    <button class="view-details-btn bg-gray-200 dark:bg-gray-600 px-4 py-2 rounded-lg text-sm" data-id="${station.id}">Rate Station</button>
                </div>`;
            }).join('');
        }

        container.innerHTML = `
            <h2 class="text-3xl font-bold mb-4">My Sessions</h2>
            <div id="active-session-container" class="mb-8">${activeSessionHtml}</div>
            <h3 class="text-2xl font-bold mb-4 border-t dark:border-gray-700 pt-6">Session History</h3>
            <div class="space-y-4">${bookingsHtml}</div>`;
    }

    function renderProfileView(container) {
        const evModelOptions = Object.keys(evModels).map(model => `<option value="${model}" ${userProfile.vehicle === model ? 'selected' : ''}>${model}</option>`).join('');

        const favoriteStations = stations.filter(s => userProfile.favorites.includes(s.id));
        let favoritesHtml = '<p class="text-gray-500 dark:text-gray-400">You have no favorite stations yet.</p>';
        if(favoriteStations.length > 0) {
            favoritesHtml = favoriteStations.map(station => `
                <div class="bg-gray-100 dark:bg-gray-700 p-3 rounded-md flex justify-between items-center">
                    <span>${station.name}</span>
                    <button class="favorite-btn text-red-500" data-id="${station.id}"><i class="fas fa-heart"></i></button>
                </div>
            `).join('');
        }

        container.innerHTML = `
            <h2 class="text-3xl font-bold mb-4">User Profile</h2>
            <div class="grid grid-cols-1 lg:grid-cols-3 gap-8">
                <div class="lg:col-span-2 grid grid-cols-1 md:grid-cols-2 gap-8">
                    <div class="bg-white dark:bg-gray-800 p-6 rounded-lg shadow-md">
                        <h3 class="text-xl font-semibold mb-4">My Vehicle</h3>
                        <label for="ev-model-select" class="block text-sm font-medium">Select Your EV</label>
                        <select id="ev-model-select" class="mt-1 block w-full rounded-md border-gray-300 dark:border-gray-600 dark:bg-gray-700 shadow-sm">${evModelOptions}</select>
                        <p class="text-xs mt-2 text-gray-500 dark:text-gray-400">This helps with charging estimates.</p>
                    </div>
                    <div class="bg-white dark:bg-gray-800 p-6 rounded-lg shadow-md text-center flex flex-col justify-center">
                        <h3 class="text-xl font-semibold mb-2">Loyalty Points</h3>
                        <p class="text-5xl font-bold text-indigo-500">${userProfile.loyaltyPoints}</p>
                        <p class="text-xs mt-2 text-gray-500 dark:text-gray-400">Earn 10 points for every completed charge!</p>
                    </div>
                </div>
                <div class="bg-white dark:bg-gray-800 p-6 rounded-lg shadow-md">
                    <h3 class="text-xl font-semibold mb-4">Favorite Stations</h3>
                    <div id="favorite-stations-container" class="space-y-3 max-h-64 overflow-y-auto">${favoritesHtml}</div>
                </div>
            </div>
            <div id="personal-analytics-container" class="mt-8 bg-white dark:bg-gray-800 p-6 rounded-lg shadow-md">
                <h3 class="text-2xl font-bold mb-4">My Analytics</h3>
                <div class="grid grid-cols-1 lg:grid-cols-2 gap-8">
                    <div class="h-64">
                        <h4 class="text-lg font-semibold text-center mb-2">Most Visited Stations</h4>
                        <canvas id="most-visited-chart"></canvas>
                    </div>
                    <div class="h-64">
                        <h4 class="text-lg font-semibold text-center mb-2">Energy Consumed per Station (kWh)</h4>
                        <canvas id="kwh-consumed-chart"></canvas>
                    </div>
                </div>
            </div>`;

        document.getElementById('ev-model-select').addEventListener('change', (e) => {
            userProfile.vehicle = e.target.value;
            log.info(`User ${loggedInUser.username} updated vehicle to ${userProfile.vehicle}.`);
            updateUserProfile();
            showToast('Vehicle updated!', 'success');
        });
        renderPersonalAnalytics();
    }
    
    function renderTripPlannerView(container) {
        const uniqueCities = [...new Set(stations.map(s => s.city))];
        const cityOptions = uniqueCities.map(city => `<option value="${city}">${city}</option>`).join('');

        container.innerHTML = `
            <h2 class="text-3xl font-bold mb-4">Trip Planner (Simulated)</h2>
            <div class="p-6 bg-white dark:bg-gray-800 rounded-lg shadow-md">
                <div class="grid grid-cols-1 md:grid-cols-3 gap-4 items-end">
                    <div><label for="start-city" class="block text-sm font-medium">Start City</label><select id="start-city" class="mt-1 block w-full rounded-md border-gray-300 dark:border-gray-600 dark:bg-gray-700">${cityOptions}</select></div>
                    <div><label for="end-city" class="block text-sm font-medium">End City</label><select id="end-city" class="mt-1 block w-full rounded-md border-gray-300 dark:border-gray-600 dark:bg-gray-700">${cityOptions}</select></div>
                    <button id="plan-trip-btn" class="bg-indigo-600 text-white py-2 px-4 rounded-lg hover:bg-indigo-700 h-10">Plan Trip</button>
                </div>
            </div>
            <div id="trip-results" class="mt-6 hidden">
                <h3 class="text-2xl font-semibold mb-4">Suggested Route and Stations</h3>
                <div id="trip-map" class="h-[40vh] rounded-lg shadow-md mb-6"></div>
                <div id="trip-stations-list" class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6"></div>
            </div>`;
    }

    function renderAdminDashboard(container) {
        container.innerHTML = `
            <h2 class="text-3xl font-bold mb-6 text-white">Admin Dashboard</h2>
            <div class="grid grid-cols-1 lg:grid-cols-2 gap-8">
                <div class="bg-gray-900 p-6 rounded-lg shadow-xl h-80"><h3 class="text-xl font-semibold mb-4 text-center">Session History</h3><canvas id="station-usage-chart"></canvas></div>
                <div class="bg-gray-900 p-6 rounded-lg shadow-xl h-80"><h3 class="text-xl font-semibold mb-4 text-center">Revenue Per Day (Simulated)</h3><canvas id="bookings-chart"></canvas></div>
            </div>`;
        renderAnalyticsCharts();
    }

    function renderAdminStations(container) {
        const stationRows = stations.map(s => `
            <tr class="border-b border-gray-700 hover:bg-gray-800">
                <td class="p-4 truncate" title="${s.id}">${s.id.substring(0, 5)}...</td>
                <td class="p-4 font-semibold">${s.name}</td>
                <td class="p-4">${s.city}</td>
                <td class="p-4">${s.slots.available} / ${s.slots.total}</td>
                <td class="p-4">${s.queue?.length || 0}</td>
                <td class="p-4">
                    <span class="px-2 py-1 text-xs font-semibold rounded-full ${s.status === 'Operational' ? 'bg-green-500 text-white' : 'bg-yellow-500 text-black'}">${s.status}</span>
                </td>
                <td class="p-4">
                    <button class="edit-station-btn bg-blue-600 hover:bg-blue-700 text-white px-3 py-1 rounded-md mr-2" data-id="${s.id}"><i class="fas fa-edit"></i></button>
                    <button class="delete-station-btn bg-red-600 hover:bg-red-700 text-white px-3 py-1 rounded-md" data-id="${s.id}"><i class="fas fa-trash"></i></button>
                </td>
            </tr>
        `).join('');

        container.innerHTML = `
            <div class="flex justify-between items-center mb-6">
                <h2 class="text-3xl font-bold text-white">Station Management</h2>
                <button id="add-station-btn" class="bg-green-600 hover:bg-green-700 text-white font-bold py-2 px-4 rounded-lg"><i class="fas fa-plus mr-2"></i>Add New Station</button>
            </div>
            <div class="bg-gray-900 rounded-lg shadow-xl overflow-x-auto">
                <table class="w-full text-left">
                    <thead>
                        <tr class="bg-gray-800">
                            <th class="p-4">ID</th><th class="p-4">Name</th><th class="p-4">City</th><th class="p-4">Slots</th><th class="p-4">Queue</th><th class="p-4">Status</th><th class="p-4">Actions</th>
                        </tr>
                    </thead>
                    <tbody>${stationRows}</tbody>
                </table>
            </div>`;
    }

    function renderAdminReviews(container) {
        let reviewsHtml = '<p class="text-gray-400">No reviews submitted yet.</p>';
        if (reviews.length > 0) {
            reviewsHtml = reviews.map(review => {
                const station = stations.find(s => s.id === review.stationId);
                return `
                <div class="bg-gray-900 p-4 rounded-lg shadow-lg">
                    <div class="flex justify-between items-start">
                        <div>
                            <p class="font-bold">${station?.name || 'Unknown Station'}</p>
                            <p class="text-sm text-yellow-400">${'★'.repeat(review.rating)}${'☆'.repeat(5 - review.rating)}</p>
                            <p class="mt-2 italic text-gray-300">"${review.text}"</p>
                            <p class="text-xs text-gray-500 mt-1">- ${review.username}</p>
                        </div>
                        <button class="delete-review-btn bg-red-600 hover:bg-red-700 text-white px-3 py-1 rounded-md" data-id="${review.id}"><i class="fas fa-trash"></i></button>
                    </div>
                </div>`
            }).join('');
        }
        container.innerHTML = `
            <h2 class="text-3xl font-bold text-white mb-6">Review Moderation</h2>
            <div class="space-y-4">${reviewsHtml}</div>`;
    }
    
    // --- MAP LOGIC ---
    function initMap(center = [20.5937, 78.9629], zoom = 5) {
        if (map) { map.remove(); map = null; }
        const mapElement = document.getElementById('map') || document.getElementById('trip-map');
        if (!mapElement) {
            log.error('Map element not found in the DOM.');
            return;
        }
        log.info('Initializing map...', { center, zoom });
        map = L.map(mapElement).setView(center, zoom);
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        }).addTo(map);
        updateMarkers();
    }

    function updateMarkers() {
        if (!map) return;
        Object.values(markers).forEach(marker => map.removeLayer(marker));
        markers = {};
        getFilteredStations().forEach(station => {
            const icon = getMarkerIcon(station);
            const marker = L.marker([station.lat, station.lng], { icon }).addTo(map);
            marker.bindPopup(`
                <div class="p-1">
                    <strong class="text-lg">${station.name}</strong><br>
                    <p>${getStationStatus(station).text} (${station.slots.available}/${station.slots.total} free)</p>
                    <button class="view-details-btn mt-2 bg-indigo-600 text-white px-3 py-1 rounded-md text-sm w-full hover:bg-indigo-700" data-id="${station.id}">View Details</button>
                </div>
            `);
            markers[station.id] = marker;
        });
        log.info('Map markers updated based on filters.');
    }

    function getMarkerIcon(station) {
        const status = getStationStatus(station);
        return L.divIcon({
            className: 'custom-div-icon',
            html: `<div style="background-color:${status.color};" class="w-8 h-8 rounded-full flex items-center justify-center shadow-lg border-2 border-white dark:border-gray-800"><i class="fas fa-bolt text-white"></i></div>`,
            iconSize: [30, 30],
            iconAnchor: [15, 30],
            popupAnchor: [0, -30]
        });
    }

    // --- STATION LIST & FILTERING ---
    function renderStationList() {
        const container = document.getElementById('station-list-container');
        if (!container) return;
        const filteredStations = getFilteredStations();
        if(filteredStations.length === 0) {
            container.innerHTML = `<p class="text-gray-500 dark:text-gray-400 md:col-span-2 xl:col-span-3 text-center">No stations match the current filters.</p>`;
            return;
        }
        container.innerHTML = filteredStations.map(station => {
            const isFavorite = userProfile.favorites.includes(station.id);
            const status = getStationStatus(station);
            const isInQueue = station.queue && station.queue.includes(loggedInUser.uid);
            const isPeak = station.currentPrice > station.pricePerKwh;
            const imageUrl = station.images?.[0] || 'https://placehold.co/600x400/cccccc/ffffff?text=No+Image';

            let actionButtonHtml = '';
            if (status.text === 'Busy') {
                if(isInQueue) {
                    actionButtonHtml = `<button class="w-full bg-yellow-500 text-black px-4 py-2 rounded-lg text-sm" disabled>In Queue (#${station.queue.indexOf(loggedInUser.uid) + 1})</button>`;
                } else {
                    actionButtonHtml = `<button class="join-queue-btn w-full bg-yellow-500 text-black px-4 py-2 rounded-lg text-sm hover:bg-yellow-600" data-id="${station.id}">Join Queue</button>`;
                }
            } else if (status.text === 'Available') {
                 actionButtonHtml = `<button class="book-slot-btn w-full bg-indigo-600 text-white px-4 py-2 rounded-lg text-sm hover:bg-indigo-700" data-id="${station.id}">Book Now</button>`;
            } else { // Maintenance
                actionButtonHtml = `<button class="w-full bg-gray-400 text-gray-800 px-4 py-2 rounded-lg text-sm" disabled>Unavailable</button>`;
            }

            return `
            <div class="bg-white dark:bg-gray-800 rounded-lg shadow-lg overflow-hidden flex flex-col transition-transform hover:scale-105 duration-300">
                <div class="relative">
                    <img src="${imageUrl}" alt="${station.name}" class="w-full h-48 object-cover">
                    ${isPeak ? `<div class="absolute top-2 right-2 bg-red-500 text-white text-xs font-bold px-2 py-1 rounded-full"><i class="fas fa-clock mr-1"></i>PEAK</div>` : ''}
                </div>
                <div class="p-4 flex flex-col flex-grow">
                    <div class="flex justify-between items-start mb-2">
                        <h3 class="text-xl font-bold">${station.name}</h3>
                        <button class="favorite-btn text-2xl ${isFavorite ? 'text-red-500' : 'text-gray-300 dark:text-gray-500'}" data-id="${station.id}"><i class="${isFavorite ? 'fas' : 'far'} fa-heart"></i></button>
                    </div>
                    <div class="flex items-center text-sm mb-2">
                        <span class="w-3 h-3 rounded-full mr-2" style="background-color: ${status.color};"></span>
                        <span>${status.text} - ${station.slots.available}/${station.slots.total} slots</span>
                        <span class="ml-auto"><i class="fas fa-users mr-1"></i> ${station.queue?.length || 0} in queue</span>
                    </div>
                    <div class="text-sm text-gray-600 dark:text-gray-400 mb-3">
                        <i class="fas fa-charging-station mr-2"></i> ${(station.chargerTypes || []).join(', ')}
                    </div>
                    <div class="mt-auto pt-4 border-t dark:border-gray-700 flex gap-2">
                        ${actionButtonHtml}
                        <button class="view-details-btn flex-1 bg-gray-200 dark:bg-gray-600 px-4 py-2 rounded-lg text-sm" data-id="${station.id}">Details</button>
                    </div>
                </div>
            </div>`;
        }).join('');
    }

    function getFilteredStations() {
        return stations.filter(station => {
            const nameMatch = station.name.toLowerCase().includes(filterState.searchTerm?.toLowerCase() || '');
            const chargerMatch = !filterState.chargerType || (station.chargerTypes || []).includes(filterState.chargerType);
            const amenityMatch = !filterState.amenity || (station.amenities || []).includes(filterState.amenity);
            const availabilityMatch = !filterState.availableOnly || station.slots.available > 0;
            return nameMatch && chargerMatch && amenityMatch && availabilityMatch;
        });
    }

    function applyFilters() {
        const searchInput = document.getElementById('search-input');
        const chargerTypeFilter = document.getElementById('charger-type-filter');
        const amenitiesFilter = document.getElementById('amenities-filter');
        const availableOnlyCheckbox = document.getElementById('available-only-checkbox');

        filterState = {
            searchTerm: searchInput ? searchInput.value : '',
            chargerType: chargerTypeFilter ? chargerTypeFilter.value : '',
            amenity: amenitiesFilter ? amenitiesFilter.value : '',
            availableOnly: availableOnlyCheckbox ? availableOnlyCheckbox.checked : false,
        };
        localStorage.setItem('ev_filterState', JSON.stringify(filterState));
        log.info('Filters applied.', filterState);

        const activePage = document.querySelector('.nav-link.active')?.dataset.page;
        if (activePage === 'station-list') renderStationList();
        if (activePage === 'map-view') updateMarkers();
    }

    // --- MODALS (Booking, Station Detail, Admin) ---
    function openBookingModal(stationId) {
        log.info(`Opening booking modal for station ID: ${stationId}`);
        const station = stations.find(s => s.id === stationId);
        const modal = document.getElementById('booking-modal');

        modal.innerHTML = `
            <div class="bg-white dark:bg-gray-800 p-6 rounded-lg shadow-xl w-full max-w-md relative">
                <button class="close-modal-btn absolute top-3 right-4 text-2xl">&times;</button>
                <h3 class="text-2xl font-bold mb-4">Book & Estimate</h3>
                <p class="mb-4">For ${station.name}</p>
                <form id="booking-form" data-id="${stationId}">
                    <div class="grid grid-cols-2 gap-4 mb-4">
                        <div>
                            <label for="current-soc" class="block text-sm font-medium mb-1">Current %</label>
                            <input type="number" id="current-soc" value="20" min="0" max="99" class="w-full rounded-md border-gray-300 dark:border-gray-600 dark:bg-gray-700">
                        </div>
                        <div>
                            <label for="target-soc" class="block text-sm font-medium mb-1">Target %</label>
                            <input type="number" id="target-soc" value="80" min="1" max="100" class="w-full rounded-md border-gray-300 dark:border-gray-600 dark:bg-gray-700">
                        </div>
                    </div>
                    <div id="estimation-box" class="mb-4 p-4 bg-gray-100 dark:bg-gray-700 rounded-lg text-center">
                        </div>
                    <button type="submit" class="w-full bg-green-600 text-white py-2 rounded-lg hover:bg-green-700">Confirm and Start Charging</button>
                </form>
            </div>`;
        modal.classList.remove('hidden');

        const currentSocInput = document.getElementById('current-soc');
        const targetSocInput = document.getElementById('target-soc');

        const updateEstimates = () => {
            const currentSoc = parseInt(currentSocInput.value) || 0;
            const targetSoc = parseInt(targetSocInput.value) || 0;
            if (targetSoc <= currentSoc) {
                document.getElementById('estimation-box').innerHTML = `<p class="text-red-500">Target % must be higher than Current %</p>`;
                return;
            }
            const car = evModels[userProfile.vehicle];
            const kwhNeeded = ((targetSoc - currentSoc) / 100) * car.battery;
            const estimatedCost = kwhNeeded * (station.currentPrice || station.pricePerKwh);
            const estimatedTime = (kwhNeeded / 25) * 60; // in minutes, assuming 25kW speed

            document.getElementById('estimation-box').innerHTML = `
                <p class="text-sm">You need approx. <strong class="text-lg">${kwhNeeded.toFixed(1)} kWh</strong></p>
                <div class="flex justify-around mt-2">
                    <span><i class="fas fa-clock mr-1"></i> ~${Math.round(estimatedTime)} mins</span>
                    <span><i class="fas fa-rupee-sign mr-1"></i> ~${estimatedCost.toFixed(2)}</span>
                </div>
            `;
        };

        currentSocInput.addEventListener('input', updateEstimates);
        targetSocInput.addEventListener('input', updateEstimates);
        updateEstimates();
    }

    function openStationDetailModal(stationId) {
        log.info(`Opening station detail modal for station ID: ${stationId}`);
        const station = stations.find(s => s.id === stationId);
        const modal = document.getElementById('station-detail-modal');
        const stationReviews = reviews.filter(r => r.stationId === stationId);
        const imageUrl = station.images?.[0] || 'https://placehold.co/600x400/cccccc/ffffff?text=No+Image';

        modal.innerHTML = `
            <div class="bg-white dark:bg-gray-800 p-6 rounded-lg shadow-xl w-full max-w-2xl relative max-h-[90vh] flex flex-col">
                <button class="close-modal-btn absolute top-3 right-4 text-2xl">&times;</button>
                <img src="${imageUrl}" onerror="this.onerror=null;this.src='https://placehold.co/600x400/cccccc/ffffff?text=Image+Not+Found';" class="w-full h-56 object-cover rounded-lg mb-4">
                <h3 class="text-3xl font-bold mb-2">${station.name}</h3>
                <div class="flex-grow overflow-y-auto pr-2">
                    <p class="text-gray-500 dark:text-gray-400 mb-2">${station.city}</p>
                    <p class="text-gray-500 dark:text-gray-400 mb-4"><i class="fas fa-mobile-alt mr-2"></i>${station.mobile || 'Not Available'}</p>
                    <div class="grid grid-cols-2 gap-4 mb-4 text-center">
                        <div class="bg-gray-100 dark:bg-gray-700 p-3 rounded-lg">
                            <p class="text-sm">Price</p>
                            <p class="font-bold text-lg">₹${(station.currentPrice || station.pricePerKwh).toFixed(2)}/kWh ${(station.currentPrice > station.pricePerKwh) ? '<span class="text-red-500 text-xs">(Peak)</span>' : ''}</p>
                        </div>
                        <div class="bg-gray-100 dark:bg-gray-700 p-3 rounded-lg">
                            <p class="text-sm">Availability</p>
                            <p class="font-bold text-lg">${station.slots.available} / ${station.slots.total} Slots</p>
                        </div>
                    </div>
                    <div class="mb-4">
                        <h4 class="font-semibold mb-2">Charger Types</h4>
                        <div class="flex flex-wrap gap-2">${(station.chargerTypes || []).map(c => `<span class="bg-indigo-100 dark:bg-indigo-900 text-indigo-800 dark:text-indigo-200 text-xs font-medium px-2.5 py-0.5 rounded">${c}</span>`).join('')}</div>
                    </div>
                    <div class="mb-4">
                        <h4 class="font-semibold mb-2">Amenities</h4>
                        <div class="flex flex-wrap gap-2">${(station.amenities || []).map(a => `<span class="bg-green-100 dark:bg-green-900 text-green-800 dark:text-green-200 text-xs font-medium px-2.5 py-0.5 rounded">${a}</span>`).join('')}</div>
                    </div>
                    <div class="mb-4">
                        <h4 class="font-semibold mb-2">Reviews (${stationReviews.length})</h4>
                        <div class="space-y-3 max-h-40 overflow-y-auto">
                            ${stationReviews.length > 0 ? stationReviews.map(r => `
                                <div class="bg-gray-100 dark:bg-gray-700 p-3 rounded-md">
                                    <p class="text-yellow-400">${'★'.repeat(r.rating)}${'☆'.repeat(5 - r.rating)}</p>
                                    <p class="italic">"${r.text}"</p>
                                    <p class="text-xs text-right text-gray-500 dark:text-gray-400">- ${r.username}</p>
                                </div>`).join('') : '<p>No reviews yet.</p>'}
                        </div>
                    </div>
                </div>
                <div class="mt-auto pt-4 border-t dark:border-gray-700">
                     <form id="review-form" data-id="${stationId}">
                        <h4 class="font-semibold mb-2">Leave a Review</h4>
                        <div class="flex items-center mb-2">
                            <div class="flex text-2xl text-gray-300" id="star-rating">${[...Array(5)].map((_, i) => `<i class="far fa-star cursor-pointer" data-value="${i+1}"></i>`).join('')}</div>
                            <input type="hidden" id="rating-value" required>
                        </div>
                        <div class="flex gap-2">
                            <textarea id="review-text" rows="1" class="flex-grow rounded-md border-gray-300 dark:border-gray-600 dark:bg-gray-700" placeholder="Your experience..." required></textarea>
                            <button type="submit" class="bg-indigo-600 text-white px-4 rounded-lg hover:bg-indigo-700">Submit</button>
                        </div>
                    </form>
                </div>
            </div>`;
        modal.classList.remove('hidden');

        const stars = modal.querySelectorAll('#star-rating i');
        stars.forEach(star => {
            star.addEventListener('mouseover', (e) => {
                const rating = e.target.dataset.value;
                stars.forEach((s, i) => s.className = i < rating ? 'fas fa-star text-yellow-400' : 'far fa-star');
            });
            star.addEventListener('mouseout', () => {
                const currentRating = document.getElementById('rating-value').value || 0;
                stars.forEach((s, i) => s.className = i < currentRating ? 'fas fa-star text-yellow-400' : 'far fa-star');
            });
            star.addEventListener('click', (e) => {
                document.getElementById('rating-value').value = e.target.dataset.value;
            });
        });
    }

    function openAdminStationModal(stationId = null) {
        const isEditing = stationId !== null;
        log.info(`Admin opening station modal.`, { isEditing, stationId });
        const station = isEditing ? stations.find(s => s.id === stationId) : {};
        const modal = document.getElementById('admin-station-modal');

        modal.innerHTML = `
            <div class="bg-gray-800 p-6 rounded-lg shadow-xl w-full max-w-2xl relative text-white">
                <button class="close-modal-btn absolute top-3 right-4 text-2xl">&times;</button>
                <h3 class="text-2xl font-bold mb-6">${isEditing ? 'Edit' : 'Add'} Station</h3>
                <form id="admin-station-form" class="space-y-4">
                    <input type="hidden" id="station-id" value="${station.id || ''}">
                    <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div><label>Name</label><input type="text" id="station-name" class="w-full bg-gray-700 p-2 rounded" value="${station.name || ''}" required></div>
                        <div><label>City</label><input type="text" id="station-city" class="w-full bg-gray-700 p-2 rounded" value="${station.city || ''}" required></div>
                        <div><label>Latitude</label><input type="number" step="any" id="station-lat" class="w-full bg-gray-700 p-2 rounded" value="${station.lat || ''}" required></div>
                        <div><label>Longitude</label><input type="number" step="any" id="station-lng" class="w-full bg-gray-700 p-2 rounded" value="${station.lng || ''}" required></div>
                        <div><label>Total Slots</label><input type="number" id="station-slots-total" class="w-full bg-gray-700 p-2 rounded" value="${station.slots?.total || ''}" required></div>
                        <div><label>Available Slots</label><input type="number" id="station-slots-available" class="w-full bg-gray-700 p-2 rounded" value="${station.slots?.available || ''}" required></div>
                        <div><label>Price/kWh</label><input type="number" id="station-price" class="w-full bg-gray-700 p-2 rounded" value="${station.pricePerKwh || ''}" required></div>
                        <div><label>Mobile</label><input type="text" id="station-mobile" class="w-full bg-gray-700 p-2 rounded" value="${station.mobile || ''}"></div>
                    </div>
                     <div><label>Status</label><select id="station-status" class="w-full bg-gray-700 p-2 rounded mt-4"><option ${station.status === 'Operational' ? 'selected' : ''}>Operational</option><option ${station.status === 'Maintenance' ? 'selected' : ''}>Maintenance</option></select></div>
                     <div><label>Image URL</label><input type="text" id="station-image" class="w-full bg-gray-700 p-2 rounded" value="${station.images?.[0] || 'https://placehold.co/600x400'}" required></div>
                    <div><label>Amenities (comma-separated)</label><input type="text" id="station-amenities" class="w-full bg-gray-700 p-2 rounded" value="${(station.amenities || []).join(', ')}"></div>
                    <div><label>Charger Types (comma-separated)</label><input type="text" id="station-chargers" class="w-full bg-gray-700 p-2 rounded" value="${(station.chargerTypes || []).join(', ')}"></div>
                    <button type="submit" class="w-full bg-green-600 text-white py-2 rounded-lg hover:bg-green-700">${isEditing ? 'Save Changes' : 'Create Station'}</button>
                </form>
            </div>`;
        modal.classList.remove('hidden');
    }

    function closeModal(modalId) {
        document.getElementById(modalId).classList.add('hidden');
        log.info(`Modal '${modalId}' closed.`);
    }

    // --- CHARGING SESSION & SIMULATION ---
    async function startCharging(stationId) {
        const stationRef = db.collection('stations').doc(stationId);
        try {
            await db.runTransaction(async (transaction) => {
                const stationDoc = await transaction.get(stationRef);
                if (!stationDoc.exists) throw "Station does not exist!";
                const stationData = stationDoc.data();
                if (stationData.slots.available <= 0) throw "No available slots!";
                
                transaction.update(stationRef, { "slots.available": stationData.slots.available - 1 });
                
                const sessionData = {
                    userId: loggedInUser.uid,
                    stationId: stationId,
                    startTime: firebase.firestore.FieldValue.serverTimestamp(),
                };
                const sessionRef = db.collection('activeSessions').doc();
                transaction.set(sessionRef, sessionData);
            });
            log.info(`User ${loggedInUser.username} started charging at station ID: ${stationId}.`);
            await fetchUserData();
            showToast('Charging session started!', 'success');
            showUserPage('my-sessions');
        } catch (error) {
            log.error("Charging transaction failed: ", error);
            showToast("Could not start charging session. " + error, "error");
        }
    }

    function startSessionTimer(session) {
        clearInterval(sessionInterval);
        if (!session.startTime) return; 
        const startTime = session.startTime.toDate().getTime();
        const station = stations.find(s => s.id === session.stationId);
        if (!station) return;

        sessionInterval = setInterval(() => {
            const now = Date.now();
            const elapsedTime = Math.floor((now - startTime) / 1000);
            const kwhConsumed = (elapsedTime / 3600) * 25; // Assume 25kW speed
            const cost = kwhConsumed * (station.currentPrice || station.pricePerKwh);

            const timerEl = document.getElementById('session-timer');
            if (timerEl) {
                document.getElementById('session-kwh').textContent = `${kwhConsumed.toFixed(2)} kWh`;
                document.getElementById('session-cost').textContent = `₹${cost.toFixed(2)}`;
                timerEl.textContent = new Date(elapsedTime * 1000).toISOString().substr(11, 8);
            } else {
                clearInterval(sessionInterval);
            }
        }, 1000);
    }

    async function stopCharging(sessionId) {
        clearInterval(sessionInterval);
        const sessionRef = db.collection('activeSessions').doc(sessionId);
        try {
            const sessionDoc = await sessionRef.get();
            if (!sessionDoc.exists) throw "Session not found!";
            const session = sessionDoc.data();
            
            const stationRef = db.collection('stations').doc(session.stationId);
            const userRef = db.collection('users').doc(loggedInUser.uid);

            const startTime = session.startTime.toDate().getTime();
            const duration = Math.floor((Date.now() - startTime) / 1000);
            const kwhConsumed = (duration / 3600) * 25;
            const stationData = stations.find(s => s.id === session.stationId);
            const cost = kwhConsumed * (stationData.currentPrice || stationData.pricePerKwh);

            await db.runTransaction(async (transaction) => {
                transaction.delete(sessionRef);
                transaction.update(stationRef, { "slots.available": firebase.firestore.FieldValue.increment(1) });
                transaction.update(userRef, { "profile.loyaltyPoints": firebase.firestore.FieldValue.increment(10) });
                
                const bookingRef = db.collection('bookings').doc();
                transaction.set(bookingRef, {
                    userId: session.userId,
                    stationId: session.stationId,
                    createdAt: firebase.firestore.FieldValue.serverTimestamp(),
                    duration,
                    cost,
                    kwhConsumed
                });
            });

            log.info(`User ${loggedInUser.username} stopped charging session.`);
            userProfile.loyaltyPoints += 10;
            await fetchUserData();
            showToast(`Charging complete! You earned 10 loyalty points.`, 'success');
            showUserPage('my-sessions');
        } catch (error) {
            log.error("Error stopping charging session:", error);
            showToast("Failed to stop session.", "error");
        }
    }
    
    // --- ANALYTICS ---
    function renderAnalyticsCharts() {
        log.info('Rendering admin analytics charts.');
        Object.values(charts).forEach(chart => chart.destroy());

        const sessionHistoryCtx = document.getElementById('station-usage-chart')?.getContext('2d');
        if (sessionHistoryCtx) {
            const stationUsage = bookings.reduce((acc, booking) => {
                const stationName = stations.find(s => s.id === booking.stationId)?.name || 'Unknown';
                acc[stationName] = (acc[stationName] || 0) + 1;
                return acc;
            }, {});
            charts.stationUsage = new Chart(sessionHistoryCtx, {
                type: 'bar',
                data: {
                    labels: Object.keys(stationUsage),
                    datasets: [{
                        label: '# of Sessions',
                        data: Object.values(stationUsage),
                        backgroundColor: 'rgba(79, 70, 229, 0.8)',
                        borderColor: 'rgba(79, 70, 229, 1)',
                        borderWidth: 1
                    }]
                },
                options: { scales: { y: { beginAtZero: true, ticks: { stepSize: 1 } } }, responsive: true, maintainAspectRatio: false }
            });
        }
    }

    function renderPersonalAnalytics() {
        log.info(`Rendering personal analytics for user: ${loggedInUser.username}`);
        Object.values(charts).forEach(chart => chart.destroy());
        const userBookings = bookings.filter(b => b.userId === loggedInUser.uid);

        const visitedCtx = document.getElementById('most-visited-chart')?.getContext('2d');
        if (visitedCtx) {
            const stationUsage = userBookings.reduce((acc, booking) => {
                const stationName = stations.find(s => s.id === booking.stationId)?.name || 'Unknown';
                acc[stationName] = (acc[stationName] || 0) + 1;
                return acc;
            }, {});
            charts.visited = new Chart(visitedCtx, {
                type: 'pie',
                data: {
                    labels: Object.keys(stationUsage),
                    datasets: [{ data: Object.values(stationUsage), backgroundColor: ['#4f46e5', '#10b981', '#f59e0b', '#ef4444', '#6366f1'] }]
                },
                options: { responsive: true, maintainAspectRatio: false }
            });
        }

        const kwhCtx = document.getElementById('kwh-consumed-chart')?.getContext('2d');
        if (kwhCtx) {
            const kwhUsage = userBookings.reduce((acc, booking) => {
                const stationName = stations.find(s => s.id === booking.stationId)?.name || 'Unknown';
                acc[stationName] = (acc[stationName] || 0) + booking.kwhConsumed;
                return acc;
            }, {});
            charts.kwh = new Chart(kwhCtx, {
                type: 'bar',
                data: {
                    labels: Object.keys(kwhUsage),
                    datasets: [{ label: 'kWh Consumed', data: Object.values(kwhUsage).map(v => v.toFixed(2)), backgroundColor: '#3b82f6' }]
                },
                options: { scales: { y: { beginAtZero: true } }, responsive: true, maintainAspectRatio: false }
            });
        }
    }

    // --- ONBOARDING & TRIP PLANNER ---
    async function startOnboardingTour() {
        const overlay = document.getElementById('onboarding-modal-overlay');
        overlay.classList.remove('hidden');
        log.info(`Starting onboarding tour for user: ${loggedInUser.username}`);

        const steps = [
            { element: '#tour-step-1', text: 'Welcome! This is the Map View where you can find all charging stations.' },
            { element: '#tour-step-2', text: 'Switch to the Station List for a detailed card view of chargers.' },
            { element: '#tour-step-3', text: 'Check your Profile for settings, favorites, and your personal analytics. Enjoy!' }
        ];
        let currentStep = 0;

        const showStep = () => {
            document.querySelectorAll('.onboarding-tooltip').forEach(el => el.remove());
            if (currentStep >= steps.length) {
                endTour();
                return;
            }
            const step = steps[currentStep];
            const targetElement = document.querySelector(step.element);
            if (!targetElement) { endTour(); return; }
            const rect = targetElement.getBoundingClientRect();

            const tooltip = document.createElement('div');
            tooltip.className = 'onboarding-tooltip';
            tooltip.innerHTML = `<p>${step.text}</p><div class="mt-4 flex justify-between"><button id="skip-tour" class="text-sm opacity-75">Skip</button><button id="next-step" class="bg-white text-indigo-600 px-3 py-1 rounded-md text-sm font-bold">Next</button></div>`;
            tooltip.style.left = `${rect.right + 15}px`;
            tooltip.style.top = `${rect.top}px`;
            document.body.appendChild(tooltip);

            document.getElementById('next-step').addEventListener('click', () => { currentStep++; showStep(); });
            document.getElementById('skip-tour').addEventListener('click', endTour);
        };

        const endTour = async () => {
            document.querySelectorAll('.onboarding-tooltip').forEach(el => el.remove());
            overlay.classList.add('hidden');
            userProfile.hasCompletedTour = true;
            log.info(`Onboarding tour completed or skipped by user: ${loggedInUser.username}`);
            await updateUserProfile();
        };

        showStep();
    }

    function planTrip() {
        const startCityName = document.getElementById('start-city').value;
        const endCityName = document.getElementById('end-city').value;
        log.info(`Planning trip from ${startCityName} to ${endCityName}`);
        if (startCityName === endCityName) {
            showToast('Start and end cities cannot be the same.', 'error');
            return;
        }
        const startStation = stations.find(s => s.city === startCityName);
        const endStation = stations.find(s => s.city === endCityName);
        if (!startStation || !endStation) {
            showToast('Could not find coordinates for cities.', 'error');
            return;
        }
        const startCoords = [startStation.lat, startStation.lng];
        const endCoords = [endStation.lat, endStation.lng];
        const routeStations = stations.filter(s => s.city === startCityName || s.city === endCityName);
        const listContainer = document.getElementById('trip-stations-list');
        const resultsContainer = document.getElementById('trip-results');
        listContainer.innerHTML = routeStations.map(station => {
            const status = getStationStatus(station);
            return `<div class="bg-white dark:bg-gray-800 rounded-lg shadow-md p-4"><h4 class="font-bold">${station.name} (${station.city})</h4><p class="text-sm text-gray-500 dark:text-gray-400">${status.text}</p><button class="view-details-btn mt-2 bg-indigo-600 text-white px-3 py-1 rounded-md text-sm" data-id="${station.id}">View Details</button></div>`;
        }).join('');
        resultsContainer.classList.remove('hidden');
        setTimeout(() => {
            initMap(startCoords, 7);
            L.polyline([startCoords, endCoords], {color: 'blue', dashArray: '5, 10'}).addTo(map);
            map.fitBounds([startCoords, endCoords], {padding: [50, 50]});
        }, 100);
    }

    // --- MISC & UTILITIES ---
    function getStationStatus(station) {
        if (station.status !== 'Operational') return { text: 'Under Maintenance', color: 'var(--yellow)' };
        if (station.slots.available === 0) return { text: 'Busy', color: 'var(--red)' };
        return { text: 'Available', color: 'var(--green)' };
    }

    async function toggleFavorite(stationId) {
        const index = userProfile.favorites.indexOf(stationId);
        if (index > -1) {
            userProfile.favorites.splice(index, 1);
            showToast('Removed from favorites.');
        } else {
            userProfile.favorites.push(stationId);
            showToast('Added to favorites!', 'success');
        }
        await updateUserProfile();
        const activePage = document.querySelector('.nav-link.active')?.dataset.page;
        if (activePage) showUserPage(activePage);
    }

    async function joinQueue(stationId) {
        const stationRef = db.collection('stations').doc(stationId);
        try {
            await stationRef.update({
                queue: firebase.firestore.FieldValue.arrayUnion(loggedInUser.uid)
            });
            log.info(`User ${loggedInUser.username} joined the queue for station ID: ${stationId}.`);
            showToast(`You've been added to the queue.`, 'success');
        } catch (error) {
            log.error("Error joining queue:", error);
            showToast("Could not join queue.", "error");
        }
    }

    function updateClock() {
        const clock = document.getElementById('live-clock');
        if (clock) clock.textContent = new Date().toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short'});
    }
    
    // --- EVENT LISTENERS (GLOBAL & DELEGATED) ---
    function setupEventListeners() {
        document.getElementById('login-form').addEventListener('submit', handleLogin);
        document.getElementById('register-form').addEventListener('submit', handleRegister);
        document.getElementById('login-tab').addEventListener('click', () => switchAuthTab('login'));
        document.getElementById('register-tab').addEventListener('click', () => switchAuthTab('register'));

        // FIX: Consolidated filter listeners into the main delegated listener for robustness.
        document.body.addEventListener('input', (e) => {
            if (e.target.id === 'search-input') {
                applyFilters();
            }
        });

        document.body.addEventListener('change', (e) => {
            if (['charger-type-filter', 'amenities-filter', 'available-only-checkbox'].includes(e.target.id)) {
                applyFilters();
            }
        });

        document.body.addEventListener('click', async (e) => {
            // --- Modal Close Button ---
            if (e.target.closest('.close-modal-btn')) {
                e.target.closest('.fixed').classList.add('hidden');
                return;
            }
            // --- User Buttons ---
            const bookBtn = e.target.closest('.book-slot-btn');
            if (bookBtn) { openBookingModal(bookBtn.dataset.id); return; }

            const joinQueueBtn = e.target.closest('.join-queue-btn');
            if(joinQueueBtn) { await joinQueue(joinQueueBtn.dataset.id); return; }

            const detailsBtn = e.target.closest('.view-details-btn');
            if (detailsBtn) { openStationDetailModal(detailsBtn.dataset.id); return; }

            const favoriteBtn = e.target.closest('.favorite-btn');
            if (favoriteBtn) { await toggleFavorite(favoriteBtn.dataset.id); return; }
            
            const stopChargingBtn = e.target.closest('#stop-charging-btn');
            if (stopChargingBtn) { await stopCharging(stopChargingBtn.dataset.id); return; }
            
            const planTripBtn = e.target.closest('#plan-trip-btn');
            if (planTripBtn) { planTrip(); return; }

            // --- Admin Buttons ---
            const addStationBtn = e.target.closest('#add-station-btn');
            if (addStationBtn) { openAdminStationModal(); return; }

            const editStationBtn = e.target.closest('.edit-station-btn');
            if (editStationBtn) { openAdminStationModal(editStationBtn.dataset.id); return; }

            const deleteStationBtn = e.target.closest('.delete-station-btn');
            if (deleteStationBtn) {
                if(confirm('Are you sure you want to delete this station?')){
                    const stationId = deleteStationBtn.dataset.id;
                    try {
                        await db.collection('stations').doc(stationId).delete();
                        log.info(`Admin deleted station ID: ${stationId}`);
                        showToast('Station deleted.', 'success');
                    } catch (error) {
                        log.error("Error deleting station:", error);
                        showToast('Failed to delete station.', 'error');
                    }
                }
                return;
            }
            const deleteReviewBtn = e.target.closest('.delete-review-btn');
            if (deleteReviewBtn) {
                if(confirm('Are you sure you want to delete this review?')){
                    const reviewId = deleteReviewBtn.dataset.id;
                    try {
                        await db.collection('reviews').doc(reviewId).delete();
                        log.info(`Admin deleted a review.`);
                        showToast('Review deleted.', 'success');
                        await fetchUserData();
                        renderAdminReviews(document.getElementById('admin-main-content'));
                    } catch (error) {
                        log.error("Error deleting review:", error);
                        showToast('Failed to delete review.', 'error');
                    }
                }
                return;
            }
        });

        // --- Form Submissions (Delegated) ---
        document.body.addEventListener('submit', async (e) => {
            const bookingForm = e.target.closest('#booking-form');
            if (bookingForm) {
                e.preventDefault();
                const stationId = bookingForm.dataset.id;
                await startCharging(stationId);
                closeModal('booking-modal');
                return;
            }
            
            const reviewForm = e.target.closest('#review-form');
            if (reviewForm) {
                e.preventDefault();
                const stationId = reviewForm.dataset.id;
                const rating = parseInt(document.getElementById('rating-value').value);
                const text = document.getElementById('review-text').value;
                if (!rating) { showToast('Please select a star rating.', 'error'); return; }
                
                try {
                    await db.collection('reviews').add({
                        userId: loggedInUser.uid,
                        username: loggedInUser.username,
                        stationId,
                        rating,
                        text,
                        createdAt: firebase.firestore.FieldValue.serverTimestamp()
                    });
                    showToast('Thank you for your review!', 'success');
                    await fetchUserData();
                    openStationDetailModal(stationId);
                } catch (error) {
                    log.error("Error submitting review:", error);
                    showToast('Could not submit review.', 'error');
                }
                return;
            }

            const adminStationForm = e.target.closest('#admin-station-form');
            if (adminStationForm) {
                e.preventDefault();
                const stationId = document.getElementById('station-id').value;
                const isEditing = !!stationId;
                const totalSlots = parseInt(document.getElementById('station-slots-total').value);
                const availableSlots = parseInt(document.getElementById('station-slots-available').value);
                if (availableSlots > totalSlots) {
                    showToast('Available slots cannot be greater than total slots.', 'error');
                    return;
                }
                const formData = {
                    name: document.getElementById('station-name').value,
                    city: document.getElementById('station-city').value,
                    lat: parseFloat(document.getElementById('station-lat').value),
                    lng: parseFloat(document.getElementById('station-lng').value),
                    mobile: document.getElementById('station-mobile').value,
                    slots: { total: totalSlots, available: availableSlots },
                    pricePerKwh: parseInt(document.getElementById('station-price').value),
                    status: document.getElementById('station-status').value,
                    images: [document.getElementById('station-image').value],
                    amenities: document.getElementById('station-amenities').value.split(',').map(s => s.trim()).filter(Boolean),
                    chargerTypes: document.getElementById('station-chargers').value.split(',').map(s => s.trim()).filter(Boolean),
                };
                try {
                    if (isEditing) {
                        await db.collection('stations').doc(stationId).update(formData);
                        log.info(`Admin updated station ID: ${stationId}`);
                    } else {
                        formData.queue = [];
                        await db.collection('stations').add(formData);
                        log.info(`Admin created a new station.`);
                    }
                    showToast(`Station ${isEditing ? 'updated' : 'created'}!`, 'success');
                    closeModal('admin-station-modal');
                } catch (error) {
                    log.error('Error saving station:', error);
                    showToast('Failed to save station.', 'error');
                }
                return;
            }
        });
        log.info('Global event listeners have been set up.');
    }

    // --- INITIALIZATION ---
    setupEventListeners();
});

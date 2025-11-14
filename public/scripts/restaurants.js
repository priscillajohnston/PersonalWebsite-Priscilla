import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import {
  getFirestore,
  collection,
  onSnapshot,
  Timestamp,
  GeoPoint,
  addDoc,
  serverTimestamp,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { getAnalytics } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-analytics.js';

const firebaseConfig = {
  apiKey: 'AIzaSyD5beNYVkxKcIvAEeQPojaV1BaoDmz5pXQ',
  authDomain: 'priscillapong-4fcd3.firebaseapp.com',
  projectId: 'priscillapong-4fcd3',
  storageBucket: 'priscillapong-4fcd3.firebasestorage.app',
  messagingSenderId: '832004285673',
  appId: '1:832004285673:web:9fb828eaa5f0bf4e567c78',
  measurementId: 'G-MC2Y85WCJY',
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

try {
  getAnalytics(app);
} catch (error) {
  // Analytics is optional; ignore environments where it is unavailable (e.g. localhost without HTTPS).
  console.info('Skipping Firebase Analytics initialisation', error);
}

(() => {
  const listEl = document.getElementById('restaurantsList');
  const loadingEl = document.getElementById('restaurantsLoading');
  const errorEl = document.getElementById('restaurantsError');
  const emptyEl = document.getElementById('restaurantsEmpty');
  const syncStateEl = document.getElementById('restaurantsSyncState');
  const formEl = document.getElementById('restaurantForm');
  const submitButtonEl = document.getElementById('restaurantSubmit');
  const submitStatusEl = document.getElementById('restaurantSubmitStatus');

  if (!listEl || !loadingEl || !errorEl || !emptyEl) {
    console.warn('Restaurants view elements are missing; skipping Firestore hookup.');
    return;
  }

  const LIKED_COOKIE_NAME = 'liked_restaurants';
  const LIKED_COOKIE_MAX_AGE = 60 * 60 * 24 * 365; // one year
  let likedRestaurants = readLikedRestaurantsCookie();

  const collectionRef = collection(db, 'Restaurants');

  if (formEl) {
    clearSubmitStatus();
    formEl.addEventListener('submit', handleFormSubmit);
  }

  setLoading(true);
  clearError();
  if (syncStateEl) {
    syncStateEl.hidden = true;
    syncStateEl.textContent = '';
  }

  const unsubscribe = onSnapshot(collectionRef, handleSnapshot, handleError);

  async function handleFormSubmit(event) {
    event.preventDefault();
    if (!formEl) return;

    clearSubmitStatus();

    const formData = new FormData(formEl);
    const name = stringFrom(formData.get('name'));

    if (!name) {
      setSubmitStatus('error', 'Name is required.');
      formEl.reportValidity();
      const nameInput = formEl.querySelector('input[name="name"]');
      if (nameInput) {
        nameInput.focus();
      }
      return;
    }

    const payload = {
      name,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    };

    assignOptionalString(payload, 'cuisine', formData.get('cuisine'));
    assignOptionalString(payload, 'neighborhood', formData.get('neighborhood'));
    assignOptionalString(payload, 'city', formData.get('city'));
    assignOptionalString(payload, 'state', formData.get('state'));

    const ratingRaw = stringFrom(formData.get('rating'));
    if (ratingRaw) {
      const rating = Number(ratingRaw);
      if (!Number.isNaN(rating)) {
        payload.rating = Math.max(0, Math.min(5, rating));
      }
    }

    const priceLevelRaw = stringFrom(formData.get('priceLevel'));
    if (priceLevelRaw) {
      const priceLevel = Number(priceLevelRaw);
      if (!Number.isNaN(priceLevel)) {
        payload.priceLevel = Math.max(1, Math.min(5, priceLevel));
      }
    }

    const websiteRaw = stringFrom(formData.get('website'));
    if (websiteRaw) {
      payload.website =
        websiteRaw.startsWith('http://') || websiteRaw.startsWith('https://')
          ? websiteRaw
          : `https://${websiteRaw}`;
    }

    const favoriteDishes = parseCommaSeparated(formData.get('favoriteDishes'));
    if (favoriteDishes.length) {
      payload.favoriteDishes = favoriteDishes;
    }

    const tags = parseCommaSeparated(formData.get('tags'));
    if (tags.length) {
      payload.tags = tags;
    }

    const lastVisitedRaw = stringFrom(formData.get('lastVisited'));
    if (lastVisitedRaw) {
      const lastVisitedDate = new Date(`${lastVisitedRaw}T00:00:00`);
      if (!Number.isNaN(lastVisitedDate.getTime())) {
        payload.lastVisited = Timestamp.fromDate(lastVisitedDate);
      }
    }

    assignOptionalString(payload, 'notes', formData.get('notes'));

    if (submitButtonEl) {
      submitButtonEl.disabled = true;
      submitButtonEl.setAttribute('aria-busy', 'true');
    }

    try {
      await addDoc(collectionRef, payload);
      formEl.reset();
      setSubmitStatus('success', `Added “${name}” to your Restaurants list.`);
      const nameInput = formEl.querySelector('input[name="name"]');
      if (nameInput) {
        nameInput.focus();
      }
    } catch (error) {
      console.error('Failed to add restaurant', error);
      setSubmitStatus('error', 'Could not add restaurant. Please try again.');
    } finally {
      if (submitButtonEl) {
        submitButtonEl.disabled = false;
        submitButtonEl.removeAttribute('aria-busy');
      }
    }
  }

  function handleSnapshot(snapshot) {
    setLoading(false);
    clearError();
    likedRestaurants = readLikedRestaurantsCookie();

    if (syncStateEl) {
      const mode = snapshot.metadata.fromCache ? 'Viewing cached data' : 'Live from Firestore';
      const syncTime = new Date();
      syncStateEl.textContent = `${mode} • Updated ${formatDate(syncTime)}`;
      syncStateEl.hidden = false;
    }

    if (snapshot.empty) {
      emptyEl.hidden = false;
      listEl.innerHTML = '';
      listEl.setAttribute('aria-busy', 'false');
      return;
    }

    emptyEl.hidden = true;

    const docs = snapshot.docs
      .slice()
      .sort((a, b) => {
        const valueA = normaliseSortValue(a.data().name, a.id);
        const valueB = normaliseSortValue(b.data().name, b.id);
        return valueA.localeCompare(valueB, undefined, { sensitivity: 'base' });
      });

    listEl.innerHTML = '';
    docs.forEach((docSnap) => {
      listEl.appendChild(buildCard(docSnap));
    });
    listEl.setAttribute('aria-busy', 'false');
  }

  function handleError(err) {
    setLoading(false);
    listEl.setAttribute('aria-busy', 'false');
    emptyEl.hidden = true;
    if (syncStateEl) {
      syncStateEl.hidden = true;
      syncStateEl.textContent = '';
    }

    let message = 'We couldn’t load your restaurants.';
    if (err && typeof err === 'object') {
      if (err.code) {
        message += ` (${err.code})`;
      }
      if (err.message) {
        message += ` ${err.message}`;
      }
    }
    setError(message.trim());
    console.error('Failed to load restaurants collection', err);
  }

  function buildCard(docSnap) {
    const card = document.createElement('article');
    card.className = 'restaurant-card';

    const data = docSnap.data({ serverTimestamps: 'estimate' }) || {};
    const nameText =
      typeof data.name === 'string' && data.name.trim() ? data.name : docSnap.id;

    const header = document.createElement('div');
    header.className = 'restaurant-header';

    const title = document.createElement('h3');
    title.className = 'restaurant-name';
    title.textContent = nameText;
    header.appendChild(title);

    header.appendChild(createLikeButton(docSnap.id, nameText));
    card.appendChild(header);

    const metaText = buildMetaText(data);
    if (metaText) {
      const meta = document.createElement('p');
      meta.className = 'restaurant-meta';
      meta.textContent = metaText;
      card.appendChild(meta);
    }

    const detailKeys = collectDetailKeys(data);
    if (detailKeys.length > 0) {
      const list = document.createElement('dl');
      list.className = 'restaurant-details';

      detailKeys.forEach((key) => {
        const value = data[key];
        if (value === undefined || value === null || value === '') {
          return;
        }

        const item = document.createElement('div');
        item.className = 'restaurant-detail';

        const term = document.createElement('dt');
        term.textContent = labelFor(key);
        item.appendChild(term);

        item.appendChild(renderValue(key, value));
        list.appendChild(item);
      });

      if (list.childElementCount > 0) {
        card.appendChild(list);
      }
    }

    const footer = document.createElement('footer');
    footer.className = 'restaurant-footer';
    const updatedAt = data.updatedAt || data.lastVisited || data.createdAt;
    if (updatedAt instanceof Timestamp) {
      footer.textContent = `Last updated ${formatDate(updatedAt.toDate())}`;
    } else if (updatedAt && typeof updatedAt.toDate === 'function') {
      try {
        footer.textContent = `Last updated ${formatDate(updatedAt.toDate())}`;
      } catch (error) {
        footer.textContent = `Entry ID: ${docSnap.id}`;
      }
    } else {
      footer.textContent = `Entry ID: ${docSnap.id}`;
    }
    card.appendChild(footer);

    return card;
  }

  function buildMetaText(data) {
    const pieces = [];
    ['cuisine', 'neighborhood', 'city', 'state'].forEach((field) => {
      if (typeof data[field] === 'string' && data[field].trim()) {
        pieces.push(data[field].trim());
      }
    });

    if (typeof data.rating === 'number') {
      pieces.push(`${data.rating.toFixed(1)} / 5`);
    } else if (typeof data.rating === 'string' && data.rating.trim()) {
      pieces.push(data.rating.trim());
    }

    return pieces.join(' • ');
  }

  function collectDetailKeys(data) {
    const reserved = new Set([
      'name',
      'cuisine',
      'neighborhood',
      'city',
      'state',
      'rating',
      'likeCount',
    ]);
    const preferredOrder = [
      'favoriteDishes',
      'tags',
      'priceLevel',
      'lastVisited',
      'website',
      'phone',
      'address',
      'notes',
      'createdAt',
      'updatedAt',
    ];

    const keys = Object.keys(data).filter((key) => !reserved.has(key));
    keys.sort((a, b) => {
      const indexA = preferredOrder.indexOf(a);
      const indexB = preferredOrder.indexOf(b);
      if (indexA !== -1 || indexB !== -1) {
        if (indexA === -1) return 1;
        if (indexB === -1) return -1;
        return indexA - indexB;
      }
      return a.localeCompare(b);
    });
    return keys;
  }

  function renderValue(key, value) {
    const dd = document.createElement('dd');
    dd.className = 'restaurant-value';

    if (key === 'website' && typeof value === 'string') {
      const link = document.createElement('a');
      link.href = value;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.textContent = value.replace(/^https?:\/\//, '');
      dd.appendChild(link);
      return dd;
    }

    if (Array.isArray(value)) {
      dd.textContent = value.join(', ');
      return dd;
    }

    if (Timestamp && value instanceof Timestamp) {
      dd.textContent = formatDate(value.toDate());
      return dd;
    }

    if (value && typeof value.toDate === 'function') {
      try {
        dd.textContent = formatDate(value.toDate());
        return dd;
      } catch (error) {
        // fall through to default rendering
      }
    }

    if (GeoPoint && value instanceof GeoPoint) {
      dd.textContent = `${value.latitude.toFixed(4)}, ${value.longitude.toFixed(4)}`;
      return dd;
    }

    if (value && typeof value === 'object') {
      const pre = document.createElement('pre');
      pre.className = 'restaurant-json';
      pre.textContent = JSON.stringify(value, null, 2);
      dd.appendChild(pre);
      return dd;
    }

    if (typeof value === 'number' && key === 'priceLevel') {
      const count = Number.isFinite(value) ? Math.max(1, Math.round(value)) : 1;
      dd.textContent = '$'.repeat(Math.min(count, 5));
      return dd;
    }

    if (typeof value === 'boolean') {
      dd.textContent = value ? 'Yes' : 'No';
      return dd;
    }

    dd.textContent = String(value);
    return dd;
  }

  function labelFor(key) {
    const labels = {
      favoriteDishes: 'Favorite Dishes',
      priceLevel: 'Price Level',
      lastVisited: 'Last Visited',
      website: 'Website',
      phone: 'Phone',
      address: 'Address',
      tags: 'Tags',
      notes: 'Notes',
      createdAt: 'Created',
      updatedAt: 'Updated',
    };
    if (Object.prototype.hasOwnProperty.call(labels, key)) {
      return labels[key];
    }
    return key
      .replace(/([A-Z])/g, ' $1')
      .replace(/[_-]/g, ' ')
      .replace(/\s+/g, ' ')
      .replace(/\b\w/g, (letter) => letter.toUpperCase())
      .trim();
  }

  function normaliseSortValue(primary, fallback) {
    const value = typeof primary === 'string' && primary.trim() ? primary : fallback;
    return value ? value.toString().toLowerCase() : '';
  }

  function createLikeButton(restaurantId, restaurantName) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'restaurant-like';
    button.dataset.restaurantId = restaurantId;
    const initialState = likedRestaurants.has(restaurantId);
    setLikeButtonState(button, initialState, restaurantName);
    button.addEventListener('click', () => {
      const nextState = !likedRestaurants.has(restaurantId);
      if (nextState) {
        likedRestaurants.add(restaurantId);
      } else {
        likedRestaurants.delete(restaurantId);
      }
      setLikeButtonState(button, nextState, restaurantName);
      persistLikedRestaurants();
    });
    return button;
  }

  function setLikeButtonState(button, isLiked, restaurantName) {
    button.classList.toggle('is-liked', isLiked);
    button.setAttribute('aria-pressed', isLiked ? 'true' : 'false');
    button.setAttribute(
      'aria-label',
      isLiked
        ? `Remove “${restaurantName}” from your likes`
        : `Add “${restaurantName}” to your likes`,
    );
    button.textContent = isLiked ? '♥ Liked' : '♡ Like';
  }

  function persistLikedRestaurants() {
    try {
      const likedList = Array.from(likedRestaurants).filter(
        (id) => typeof id === 'string' && id.trim(),
      );
      if (!likedList.length) {
        document.cookie = `${LIKED_COOKIE_NAME}=;path=/;max-age=0;SameSite=Lax`;
        return;
      }
      const encoded = encodeURIComponent(JSON.stringify(likedList));
      document.cookie = `${LIKED_COOKIE_NAME}=${encoded};path=/;max-age=${LIKED_COOKIE_MAX_AGE};SameSite=Lax`;
    } catch (error) {
      console.warn('Failed to persist liked restaurants cookie', error);
    }
  }

  function readLikedRestaurantsCookie() {
    try {
      const cookieString = document.cookie || '';
      if (!cookieString) {
        return new Set();
      }
      const cookies = cookieString.split(';').map((cookie) => cookie.trim());
      const target = cookies.find((cookie) => cookie.startsWith(`${LIKED_COOKIE_NAME}=`));
      if (!target) {
        return new Set();
      }
      const value = target.substring(LIKED_COOKIE_NAME.length + 1);
      if (!value) {
        return new Set();
      }
      const decoded = decodeURIComponent(value);
      const parsed = JSON.parse(decoded);
      if (Array.isArray(parsed)) {
        return new Set(parsed.filter((item) => typeof item === 'string' && item.trim()));
      }
    } catch (error) {
      console.warn('Failed to parse liked restaurants cookie', error);
    }
    return new Set();
  }

  function setSubmitStatus(type, message) {
    if (!submitStatusEl) return;
    submitStatusEl.hidden = false;
    submitStatusEl.textContent = message;
    submitStatusEl.classList.remove('success', 'error');
    if (type) {
      submitStatusEl.classList.add(type);
    }
  }

  function clearSubmitStatus() {
    if (!submitStatusEl) return;
    submitStatusEl.hidden = true;
    submitStatusEl.textContent = '';
    submitStatusEl.classList.remove('success', 'error');
  }

  function stringFrom(value) {
    if (typeof value === 'string') {
      return value.trim();
    }
    if (value === undefined || value === null) {
      return '';
    }
    return String(value).trim();
  }

  function assignOptionalString(target, key, value) {
    const text = stringFrom(value);
    if (text) {
      target[key] = text;
    }
  }

  function parseCommaSeparated(value) {
    const text = stringFrom(value);
    if (!text) {
      return [];
    }
    return text
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
  }

  function formatDate(date) {
    try {
      return new Intl.DateTimeFormat(undefined, {
        dateStyle: 'medium',
        timeStyle: 'short',
      }).format(date);
    } catch (error) {
      return date instanceof Date ? date.toLocaleString() : String(date);
    }
  }

  function setLoading(isLoading) {
    loadingEl.hidden = !isLoading;
    listEl.setAttribute('aria-busy', isLoading ? 'true' : 'false');
  }

  function setError(message) {
    errorEl.hidden = false;
    errorEl.textContent = message;
    emptyEl.hidden = true;
  }

  function clearError() {
    errorEl.hidden = true;
    errorEl.textContent = '';
  }

  window.addEventListener('beforeunload', () => {
    if (typeof unsubscribe === 'function') {
      unsubscribe();
    }
  });
})();


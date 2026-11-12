/**
 * ShipBoost - Storefront Client Script
 * Handles real-time cart tracking, dynamic threshold calculation, and animated progress bar.
 */
(function () {
  'use strict';

  var STORAGE_KEY_DISMISSED = 'shipboost_bar_dismissed_session';

  function initShipBoost() {
    var wrapper = document.getElementById('shipboost-bar-wrapper');
    if (!wrapper) return;

    if (sessionStorage.getItem(STORAGE_KEY_DISMISSED)) {
      return; // User closed it in this session
    }

    var shopDomain = wrapper.getAttribute('data-shop') || window.location.hostname;
    var appUrl = wrapper.getAttribute('data-app-url') || '';

    // Fetch settings for this store
    var settingsUrl = appUrl + '/api/public/settings?shop=' + encodeURIComponent(shopDomain);

    fetch(settingsUrl)
      .then(function (res) {
        if (!res.ok) throw new Error('Settings not found');
        return res.json();
      })
      .then(function (settings) {
        if (!settings || !settings.isActive) {
          wrapper.style.display = 'none';
          return;
        }
        applyDesign(settings);
        fetchCartAndRender(settings);
        listenToCartEvents(settings);
      })
      .catch(function (err) {
        // Fallback default settings if backend is booting or offline
        var defaultSettings = {
          isActive: true,
          goalAmount: 50.00,
          currencySymbol: '$',
          initialMessage: 'Free Shipping on orders over {goal}!',
          progressMessage: 'Add {remaining} more to unlock FREE SHIPPING! 🚚',
          successMessage: '🎉 Congratulations! You unlocked FREE SHIPPING!',
          backgroundColor: '#111827',
          textColor: '#ffffff',
          progressColor: '#10b981',
          position: 'top'
        };
        applyDesign(defaultSettings);
        fetchCartAndRender(defaultSettings);
        listenToCartEvents(defaultSettings);
      });

    // Close button logic
    var closeBtn = document.getElementById('shipboost-close');
    if (closeBtn) {
      closeBtn.addEventListener('click', function () {
        wrapper.classList.add('shipboost-hidden');
        sessionStorage.setItem(STORAGE_KEY_DISMISSED, 'true');
      });
    }
  }

  function applyDesign(s) {
    var wrapper = document.getElementById('shipboost-bar-wrapper');
    var bar = document.getElementById('shipboost-bar');
    var progressFill = document.getElementById('shipboost-progress-fill');

    if (!wrapper || !bar) return;

    bar.style.backgroundColor = s.backgroundColor || '#111827';
    bar.style.color = s.textColor || '#ffffff';
    if (progressFill) {
      progressFill.style.backgroundColor = s.progressColor || '#10b981';
    }

    if (s.position === 'bottom') {
      wrapper.classList.remove('shipboost-pos-top');
      wrapper.classList.add('shipboost-pos-bottom');
    } else {
      wrapper.classList.remove('shipboost-pos-bottom');
      wrapper.classList.add('shipboost-pos-top');
    }
  }

  function fetchCartAndRender(settings) {
    fetch('/cart.js')
      .then(function (res) { return res.json(); })
      .then(function (cart) {
        updateBar(cart, settings);
      })
      .catch(function (e) {
        console.warn('ShipBoost could not fetch /cart.js', e);
      });
  }

  function updateBar(cart, s) {
    var wrapper = document.getElementById('shipboost-bar-wrapper');
    var messageEl = document.getElementById('shipboost-message');
    var progressFill = document.getElementById('shipboost-progress-fill');
    var iconEl = document.getElementById('shipboost-icon');

    if (!wrapper || !messageEl || !progressFill) return;

    var cartTotalCents = cart.total_price || 0;
    var cartTotal = cartTotalCents / 100.0;
    var goal = parseFloat(s.goalAmount) || 50.0;
    var currency = s.currencySymbol || '$';

    var percent = Math.min(100, Math.max(0, (cartTotal / goal) * 100));
    progressFill.style.width = percent + '%';

    if (cartTotal <= 0) {
      // Empty cart
      var msg = (s.initialMessage || 'Free Shipping on orders over {goal}!')
        .replace('{goal}', currency + goal.toFixed(2));
      messageEl.textContent = msg;
      if (iconEl) iconEl.textContent = '🚚';
    } else if (cartTotal < goal) {
      // In progress
      var remaining = (goal - cartTotal).toFixed(2);
      var msg = (s.progressMessage || 'Add {remaining} more to unlock FREE SHIPPING!')
        .replace('{remaining}', currency + remaining)
        .replace('{goal}', currency + goal.toFixed(2));
      messageEl.textContent = msg;
      if (iconEl) iconEl.textContent = '📦';
    } else {
      // Achieved
      messageEl.textContent = s.successMessage || '🎉 Congratulations! You unlocked FREE SHIPPING!';
      if (iconEl) iconEl.textContent = '🎉';
    }

    wrapper.classList.remove('shipboost-hidden');
  }

  function listenToCartEvents(settings) {
    // Intercept standard fetch calls to cart APIs in AJAX themes
    var origFetch = window.fetch;
    window.fetch = function () {
      var promise = origFetch.apply(this, arguments);
      var url = arguments[0];
      if (typeof url === 'string' && (url.includes('/cart/add') || url.includes('/cart/change') || url.includes('/cart/update') || url.includes('/cart/clear'))) {
        promise.then(function () {
          setTimeout(function () { fetchCartAndRender(settings); }, 400);
        });
      }
      return promise;
    };

    // Listen to standard custom cart events dispatched by popular Shopify themes
    var events = ['cart:updated', 'cart:change', 'cart:refresh', 'ajaxCart.afterCartLoad'];
    events.forEach(function (evt) {
      document.addEventListener(evt, function () {
        setTimeout(function () { fetchCartAndRender(settings); }, 300);
      });
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initShipBoost);
  } else {
    initShipBoost();
  }
})();

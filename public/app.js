/**
 * ShipBoost - Admin Dashboard Script
 * Handles real-time preview, settings save, and plan upgrades
 */

document.addEventListener('DOMContentLoaded', () => {
  const urlParams = new URLSearchParams(window.location.search);
  const shop = urlParams.get('shop') || 'default';

  // Elements
  const currencySymbol = document.getElementById('currency-symbol');
  const goalAmount = document.getElementById('goal-amount');
  const initialMessage = document.getElementById('initial-message');
  const progressMessage = document.getElementById('progress-message');
  const successMessage = document.getElementById('success-message');
  const barPosition = document.getElementById('bar-position');
  const bgColor = document.getElementById('bg-color');
  const bgColorHex = document.getElementById('bg-color-hex');
  const textColor = document.getElementById('text-color');
  const textColorHex = document.getElementById('text-color-hex');
  const progressColor = document.getElementById('progress-color');
  const progressColorHex = document.getElementById('progress-color-hex');
  const isActive = document.getElementById('is-active');

  const previewCartSlider = document.getElementById('preview-cart-slider');
  const previewCartLabel = document.getElementById('preview-cart-label');
  const previewBar = document.getElementById('preview-bar');
  const previewText = document.getElementById('preview-text');
  const previewProgressFill = document.getElementById('preview-progress-fill');
  const previewIcon = document.getElementById('preview-icon');

  const saveBtn = document.getElementById('save-btn');
  const upgradeBtn = document.getElementById('upgrade-btn');
  const planBadge = document.getElementById('plan-badge');
  const toast = document.getElementById('toast');

  // Sync color pickers with hex text inputs
  function bindColor(input, text) {
    input.addEventListener('input', () => {
      text.value = input.value;
      updateLivePreview();
    });
    text.addEventListener('input', () => {
      input.value = text.value;
      updateLivePreview();
    });
  }

  bindColor(bgColor, bgColorHex);
  bindColor(textColor, textColorHex);
  bindColor(progressColor, progressColorHex);

  [currencySymbol, goalAmount, initialMessage, progressMessage, successMessage].forEach(el => {
    el.addEventListener('input', updateLivePreview);
  });

  previewCartSlider.addEventListener('input', () => {
    const val = parseFloat(previewCartSlider.value);
    previewCartLabel.textContent = `${currencySymbol.value}${val.toFixed(2)}`;
    updateLivePreview();
  });

  function updateLivePreview() {
    const goal = parseFloat(goalAmount.value) || 50;
    const curr = currencySymbol.value || '$';
    const cart = parseFloat(previewCartSlider.value) || 0;

    previewBar.style.backgroundColor = bgColor.value;
    previewBar.style.color = textColor.value;
    previewProgressFill.style.backgroundColor = progressColor.value;

    const percent = Math.min(100, Math.max(0, (cart / goal) * 100));
    previewProgressFill.style.width = percent + '%';

    if (cart <= 0) {
      previewText.textContent = initialMessage.value.replace('{goal}', `${curr}${goal.toFixed(2)}`);
      previewIcon.textContent = '🚚';
    } else if (cart < goal) {
      const remaining = (goal - cart).toFixed(2);
      previewText.textContent = progressMessage.value
        .replace('{remaining}', `${curr}${remaining}`)
        .replace('{goal}', `${curr}${goal.toFixed(2)}`);
      previewIcon.textContent = '📦';
    } else {
      previewText.textContent = successMessage.value;
      previewIcon.textContent = '🎉';
    }
  }

  // Load existing settings
  fetch(`/api/settings?shop=${encodeURIComponent(shop)}`)
    .then(r => r.json())
    .then(s => {
      if (!s) return;
      currencySymbol.value = s.currencySymbol || '$';
      goalAmount.value = s.goalAmount || 50;
      initialMessage.value = s.initialMessage || 'Free Shipping on orders over {goal}! 🚚';
      progressMessage.value = s.progressMessage || 'Add {remaining} more to unlock FREE SHIPPING! 📦';
      successMessage.value = s.successMessage || '🎉 Congratulations! You unlocked FREE SHIPPING!';
      barPosition.value = s.position || 'top';
      bgColor.value = s.backgroundColor || '#111827';
      bgColorHex.value = bgColor.value;
      textColor.value = s.textColor || '#ffffff';
      textColorHex.value = textColor.value;
      progressColor.value = s.progressColor || '#10b981';
      progressColorHex.value = progressColor.value;
      isActive.checked = s.isActive !== false;

      if (s.plan === 'pro') {
        planBadge.textContent = 'Pro Plan ($9.99/mo)';
        planBadge.className = 'badge badge-pro';
        upgradeBtn.textContent = '✓ Pro Plan Active';
        upgradeBtn.disabled = true;
      }

      previewCartLabel.textContent = `${currencySymbol.value}20.00`;
      updateLivePreview();
    })
    .catch(err => console.error('Error loading settings', err));

  // Save Settings
  saveBtn.addEventListener('click', () => {
    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving...';

    const payload = {
      shop: shop,
      settings: {
        currencySymbol: currencySymbol.value,
        goalAmount: parseFloat(goalAmount.value) || 50,
        initialMessage: initialMessage.value,
        progressMessage: progressMessage.value,
        successMessage: successMessage.value,
        position: barPosition.value,
        backgroundColor: bgColor.value,
        textColor: textColor.value,
        progressColor: progressColor.value,
        isActive: isActive.checked
      }
    };

    fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    })
      .then(r => r.json())
      .then(data => {
        saveBtn.disabled = false;
        saveBtn.textContent = 'Save Changes';
        showToast('Settings saved successfully!');
      })
      .catch(err => {
        saveBtn.disabled = false;
        saveBtn.textContent = 'Save Changes';
        showToast('Error saving settings.');
      });
  });

  // Upgrade Plan
  upgradeBtn.addEventListener('click', () => {
    upgradeBtn.disabled = true;
    upgradeBtn.textContent = 'Processing Upgrade...';

    fetch('/api/billing/upgrade', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ shop: shop })
    })
      .then(r => r.json())
      .then(data => {
        if (data.confirmationUrl) {
          window.top.location.href = data.confirmationUrl;
          return;
        }
        if (data.success) {
          planBadge.textContent = 'Pro Plan ($9.99/mo)';
          planBadge.className = 'badge badge-pro';
          upgradeBtn.textContent = '✓ Pro Plan Active';
          showToast(data.message || 'Upgraded to Pro Plan ($9.99/month)!');
        } else {
          upgradeBtn.disabled = false;
          upgradeBtn.textContent = 'Upgrade Store to Pro';
          showToast(data.error || 'Could not start upgrade.');
        }
      })
      .catch(err => {
        upgradeBtn.disabled = false;
        upgradeBtn.textContent = 'Upgrade Store to Pro';
        showToast('Billing error.');
      });
  });

  function showToast(msg) {
    toast.textContent = msg;
    toast.classList.remove('hidden');
    setTimeout(() => {
      toast.classList.add('hidden');
    }, 3000);
  }
});

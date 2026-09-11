/**
 * Choosing a new password from a reset link.
 *
 * The token arrives in the address bar. It is never shown on screen and never
 * put into a field - it just rides along with the request. Anything drawn on
 * the page ends up in screenshots, and this one is a key to somebody's
 * account until it is spent.
 */

const $ = (id) => document.getElementById(id);

const token = new URLSearchParams(window.location.search).get('token') || '';

function clearErrors() {
  hideNotice();
  document.querySelectorAll('.err').forEach((el) => {
    el.textContent = '';
  });
}

/** Show / hide a password, so people can check what they typed. */
function wirePasswordToggles() {
  document.querySelectorAll('.pw-toggle').forEach((button) => {
    button.addEventListener('click', () => {
      const input = $(button.dataset.toggle);
      const hidden = input.type === 'password';
      input.type = hidden ? 'text' : 'password';
      button.textContent = hidden ? 'Hide' : 'Show';
    });
  });
}

async function submit(event) {
  event.preventDefault();
  clearErrors();

  const button = $('submit');
  const label = button.textContent;
  button.disabled = true;
  button.textContent = 'Changing…';

  try {
    await apiPost('/api/auth/reset', {
      token,
      password: $('password').value,
      confirm_password: $('confirm_password').value,
    });

    // Done. The form is replaced rather than left sitting there, because the
    // link has now been spent and pressing the button again would fail.
    $('form').remove();
    $('heading').textContent = 'Password changed';
    $('sub').textContent = '';
    showNotice('Your password has been changed. You can log in with it now.', 'success');

    setTimeout(() => {
      window.location.href = '/login.html';
    }, 2500);
  } catch (err) {
    showNotice(err.message);

    for (const [name, message] of Object.entries(err.fields || {})) {
      const box = $(`err-${name}`);
      if (box) box.textContent = message;
    }

    button.disabled = false;
    button.textContent = label;
  }
}

document.addEventListener('DOMContentLoaded', () => {
  wirePasswordToggles();
  $('form').addEventListener('submit', submit);

  // No token at all means somebody opened this page directly. Say so rather
  // than letting them fill the form in and fail at the end.
  if (!token) {
    $('form').remove();
    $('heading').textContent = 'This link is not complete';
    $('sub').textContent = '';
    showNotice(
      'Open the link from your reset email, or ask for a new one from the login page.',
      'error'
    );
  }
});

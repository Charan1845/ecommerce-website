/**
 * The login and signup page.
 *
 * Same idea as the original page: one form that flips between logging in and
 * signing up. What is new is that it talks to the REST API and shows the
 * specific message the server sends back for each field.
 */

let mode = 'login';

const $ = (id) => document.getElementById(id);

/** Where to go after a successful login. Only ever a path on this site. */
function nextUrl() {
  const raw = new URLSearchParams(window.location.search).get('next') || '/';
  return raw.startsWith('/') && !raw.startsWith('//') ? raw : '/';
}

function clearErrors() {
  hideNotice();
  document.querySelectorAll('.err').forEach((el) => { el.textContent = ''; });
}

function showFieldErrors(fields) {
  for (const [name, message] of Object.entries(fields)) {
    const box = $(`err-${name}`);
    if (box) box.textContent = message;
  }
}

function setMode(next) {
  mode = next;
  clearErrors();

  const signingUp = mode === 'signup';

  $('tab-login').classList.toggle('active', !signingUp);
  $('tab-signup').classList.toggle('active', signingUp);
  $('field-email').hidden = !signingUp;
  $('signup-details').hidden = !signingUp;

  $('heading').textContent = signingUp ? 'Create your account' : 'Welcome back';
  $('sub').textContent = signingUp
    ? 'One account for your cart and your orders.'
    : 'Log in to your DevGear account.';
  $('submit').textContent = signingUp ? 'Sign up' : 'Log in';

  $('foot').innerHTML = signingUp
    ? 'Already have an account? <button type="button" id="foot-switch">Log in</button>'
    : 'New to DevGear? <button type="button" id="foot-switch">Create an account</button>';
  $('foot-switch').addEventListener('click', () => setMode(signingUp ? 'login' : 'signup'));

  $('password').autocomplete = signingUp ? 'new-password' : 'current-password';

  // Only require the extra fields when they are actually on screen, otherwise
  // the browser blocks submitting a form with hidden required boxes.
  ['email', 'confirm_password'].forEach((id) => { $(id).required = signingUp; });
}

async function submit(event) {
  event.preventDefault();
  clearErrors();

  const button = $('submit');
  button.disabled = true;
  const label = button.textContent;
  button.textContent = 'Please wait…';

  try {
    if (mode === 'signup') {
      await apiPost('/api/auth/signup', {
        username: $('username').value,
        email: $('email').value,
        password: $('password').value,
        confirm_password: $('confirm_password').value,
        phone: $('phone').value,
        state: $('state').value,
        terms: $('terms').checked,
      });
    } else {
      await apiPost('/api/auth/login', {
        username: $('username').value,
        password: $('password').value,
      });
    }

    window.location.href = nextUrl();
  } catch (err) {
    showNotice(err.message);
    showFieldErrors(err.fields || {});
    button.disabled = false;
    button.textContent = label;
  }
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

/**
 * Show the demo button only if the server actually has a demo account.
 * Deploy with DEMO_LOGIN=off and the button never appears.
 */
async function offerDemoAccount() {
  let available = false;
  try {
    ({ available } = await apiGet('/api/auth/demo'));
  } catch {
    return;
  }
  if (!available) return;

  $('demo-block').hidden = false;

  $('demo-btn').addEventListener('click', async () => {
    const button = $('demo-btn');
    button.disabled = true;
    button.textContent = 'Signing you in…';

    try {
      await apiPost('/api/auth/demo-login');
      window.location.href = nextUrl();
    } catch (err) {
      showNotice(err.message);
      button.disabled = false;
      button.textContent = 'Look around with the demo account';
    }
  });
}

document.addEventListener('DOMContentLoaded', async () => {
  $('tab-login').addEventListener('click', () => setMode('login'));
  $('tab-signup').addEventListener('click', () => setMode('signup'));
  $('foot-switch').addEventListener('click', () => setMode('signup'));
  $('form').addEventListener('submit', submit);
  wirePasswordToggles();
  offerDemoAccount();

  if (new URLSearchParams(window.location.search).get('mode') === 'signup') {
    setMode('signup');
  }

  // Already logged in? No reason to be here.
  const user = await whoAmI();
  if (user) window.location.href = nextUrl();
});

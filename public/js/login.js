/**
 * The login and signup page.
 *
 * Same idea as the original page: one form that flips between logging in and
 * signing up. What is new is that it talks to the REST API and shows the
 * specific message the server sends back for each field.
 */

let mode = 'login';

/** Whether the shop has a demo account, so the button is not re-shown by mistake. */
let demoAvailable = false;

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
  const forgetting = mode === 'forgot';

  // The two tabs only make sense while choosing between them. Asking for a
  // reset link is a detour, not a third thing you might have meant to do.
  $('switcher').hidden = forgetting;
  $('tab-login').classList.toggle('active', mode === 'login');
  $('tab-signup').classList.toggle('active', signingUp);

  // Forgetting a password asks for the email address and nothing else.
  $('field-username').hidden = forgetting;
  $('field-email').hidden = !(signingUp || forgetting);
  $('field-password').hidden = forgetting;
  $('signup-details').hidden = !signingUp;
  $('forgot-row').hidden = mode !== 'login';
  $('demo-block').hidden = forgetting || !demoAvailable;

  if (forgetting) {
    $('heading').textContent = 'Forgotten your password?';
    $('sub').textContent =
      'Give us the address on your account and we will send a link to choose a new one.';
    $('submit').textContent = 'Send me a reset link';
  } else if (signingUp) {
    $('heading').textContent = 'Create your account';
    $('sub').textContent = 'One account for your cart and your orders.';
    $('submit').textContent = 'Sign up';
  } else {
    $('heading').textContent = 'Welcome back';
    $('sub').textContent = 'Log in to your DevGear account.';
    $('submit').textContent = 'Log in';
  }

  if (forgetting) {
    $('foot').innerHTML = 'Remembered it? <button type="button" id="foot-switch">Log in</button>';
  } else if (signingUp) {
    $('foot').innerHTML =
      'Already have an account? <button type="button" id="foot-switch">Log in</button>';
  } else {
    $('foot').innerHTML =
      'New to DevGear? <button type="button" id="foot-switch">Create an account</button>';
  }
  $('foot-switch').addEventListener('click', () => setMode(signingUp || forgetting ? 'login' : 'signup'));

  $('password').autocomplete = signingUp ? 'new-password' : 'current-password';

  // Only require the fields that are actually on screen, otherwise the browser
  // blocks submitting a form with hidden required boxes.
  $('username').required = !forgetting;
  $('password').required = !forgetting;
  $('email').required = signingUp || forgetting;
  $('confirm_password').required = signingUp;
}

async function submit(event) {
  event.preventDefault();
  clearErrors();

  const button = $('submit');
  button.disabled = true;
  const label = button.textContent;
  button.textContent = 'Please wait…';

  try {
    if (mode === 'forgot') {
      const result = await apiPost('/api/auth/forgot', { email: $('email').value });

      // Deliberately the same message whether or not that address has an
      // account - see the route. The page must not give away more than the
      // server chose to.
      showNotice(result.message, 'success');

      if (!result.email_configured) {
        showNotice(
          `${result.message} (This shop has no email service configured, so ` +
            'nothing will actually arrive - the link is printed in the server log.)',
          'info'
        );
      }

      button.disabled = false;
      button.textContent = label;
      return;
    }

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

  demoAvailable = true;
  if (mode !== 'forgot') $('demo-block').hidden = false;

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
  $('forgot-link').addEventListener('click', () => setMode('forgot'));
  wirePasswordToggles();
  offerDemoAccount();

  if (new URLSearchParams(window.location.search).get('mode') === 'signup') {
    setMode('signup');
  }

  // Already logged in? No reason to be here.
  const user = await whoAmI();
  if (user) window.location.href = nextUrl();
});

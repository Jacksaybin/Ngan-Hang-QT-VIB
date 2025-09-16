// Ultra-minimal service-worker style Worker for debugging local runtime issues.
// If this runs (remote or local), the problem is not with your code size/syntax.
addEventListener('fetch', event => {
    event.respondWith(new Response('ok-sw', { status: 200, headers: { 'content-type': 'text/plain' } }));
});

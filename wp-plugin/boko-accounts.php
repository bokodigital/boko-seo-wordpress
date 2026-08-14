<?php
/**
 * Plugin Name: Boko Accounts
 * Description: Turns this WordPress site into the identity and entitlement provider for the Boko SEO Studio apps. Signs members in with their existing ProfilePress membership and tells each app which plan they are on and what limits apply. Install on boko.com.au only — this is NOT the client-site bridge plugin.
 * Version: 1.3.0
 * Author: Boko Digital
 */

if (!defined('ABSPATH')) { exit; }

class Boko_Accounts {

    const VERSION      = '1.3.0';
    const OPT          = 'boko_accounts_settings';
    const TOKEN_TTL    = 900;   // signed login token: 15 minutes
    const SESSION_TTL  = 86400; // app session token: 24h, then the app re-checks /me

    /** Tiers the apps understand. Keys are stable — don't rename without updating the apps. */
    public static function tiers() {
        return array(
            'free'      => array('label' => 'Free',      'stores' => 1,  'itemsPerMonth' => 10,   'autoOptimise' => false, 'reAudit' => false),
            'store-fix' => array('label' => 'Store Fix', 'stores' => 1,  'itemsPerMonth' => 2000, 'autoOptimise' => true,  'reAudit' => true),
            'agency'    => array('label' => 'Agency',    'stores' => 10, 'itemsPerMonth' => 0,    'autoOptimise' => true,  'reAudit' => true), // 0 = unlimited
        );
    }

    public static function init() {
        add_action('rest_api_init', array(__CLASS__, 'routes'));
        add_action('admin_menu', array(__CLASS__, 'menu'));
        add_action('admin_init', array(__CLASS__, 'register_settings'));
        add_action('template_redirect', array(__CLASS__, 'handle_login_handoff'));
    }

    /* ------------------------------- settings ------------------------------- */

    public static function settings() {
        $s = get_option(self::OPT, array());
        return wp_parse_args($s, array(
            'secret'       => '',
            'plan_map'     => array(), // profilepress plan id => tier key
            'allowed_apps' => "https://boko-seo-app.vercel.app\nhttps://boko-seo-wordpress.vercel.app",
            'extra_plan_ids' => '',
            'role_map'     => array(), // wp role slug => tier key
        ));
    }

    public static function menu() {
        add_options_page('Boko Accounts', 'Boko Accounts', 'manage_options', 'boko-accounts', array(__CLASS__, 'settings_page'));
    }

    public static function register_settings() {
        register_setting('boko_accounts', self::OPT, array(__CLASS__, 'sanitize'));
    }

    public static function sanitize($in) {
        $out = array();
        $out['secret'] = isset($in['secret']) ? trim(sanitize_text_field($in['secret'])) : '';
        $out['allowed_apps'] = isset($in['allowed_apps']) ? trim($in['allowed_apps']) : '';
        $out['extra_plan_ids'] = isset($in['extra_plan_ids']) ? trim(sanitize_text_field($in['extra_plan_ids'])) : '';
        $out['role_map'] = array();
        if (isset($in['role_map']) && is_array($in['role_map'])) {
            $tiers = array_keys(self::tiers());
            foreach ($in['role_map'] as $role => $tier) {
                $role = sanitize_key($role);
                $tier = sanitize_text_field($tier);
                if ($role && in_array($tier, $tiers, true)) { $out['role_map'][$role] = $tier; }
            }
        }
        $out['plan_map'] = array();
        if (isset($in['plan_map']) && is_array($in['plan_map'])) {
            $tiers = array_keys(self::tiers());
            foreach ($in['plan_map'] as $plan_id => $tier) {
                $plan_id = intval($plan_id);
                $tier = sanitize_text_field($tier);
                if ($plan_id && in_array($tier, $tiers, true)) {
                    $out['plan_map'][$plan_id] = $tier;
                }
            }
        }
        return $out;
    }

    /**
     * Every ProfilePress membership plan on this site, as id => name.
     *
     * ProfilePress keeps plans in its own database table (not a post type) and the
     * helper functions differ between versions, so try each source in turn and fall
     * back to a self-discovering table scan. Whatever the version, we find them.
     */
    public static function profilepress_plans(&$via = null) {
        global $wpdb;
        $plans = array();

        // 1. Public helper, when the installed version has one.
        if (function_exists('ppress_get_all_plans')) {
            foreach ((array) ppress_get_all_plans() as $p) {
                if (is_object($p) && isset($p->id)) {
                    $plans[intval($p->id)] = isset($p->name) ? $p->name : ('Plan ' . $p->id);
                }
            }
            if ($plans) { $via = 'ppress_get_all_plans()'; return $plans; }
        }

        // 2. The repository class used by recent versions.
        $repo = '\\ProfilePress\\Core\\Membership\\Repositories\\PlanRepository';
        if (class_exists($repo) && method_exists($repo, 'init')) {
            try {
                $all = call_user_func(array($repo, 'init'))->retrieveAll();
                foreach ((array) $all as $p) {
                    if (is_object($p) && isset($p->id)) {
                        $plans[intval($p->id)] = isset($p->name) ? $p->name : ('Plan ' . $p->id);
                    }
                }
            } catch (\Exception $e) { /* fall through */ }
            if ($plans) { $via = 'PlanRepository'; return $plans; }
        }

        // 3. Find the plans table ourselves. Table names come from SHOW TABLES, so
        //    they're real identifiers rather than anything user-supplied.
        $tables = $wpdb->get_col("SHOW TABLES LIKE '%ppress%'");
        if (is_array($tables)) {
            // Prefer a table whose name mentions plans.
            usort($tables, function ($a, $b) {
                return (strpos($b, 'plan') !== false) - (strpos($a, 'plan') !== false);
            });
            foreach ($tables as $table) {
                $cols = $wpdb->get_col("SHOW COLUMNS FROM `" . esc_sql($table) . "`");
                if (!is_array($cols) || !in_array('id', $cols, true) || !in_array('name', $cols, true)) { continue; }
                $rows = $wpdb->get_results("SELECT `id`, `name` FROM `" . esc_sql($table) . "` ORDER BY `id` ASC LIMIT 200");
                if (!$rows) { continue; }
                foreach ($rows as $r) {
                    $plans[intval($r->id)] = $r->name !== '' ? $r->name : ('Plan ' . $r->id);
                }
                if ($plans) { $via = 'table ' . $table; return $plans; }
            }
        }

        // 4. Custom post type, for much older builds.
        $posts = get_posts(array('post_type' => 'ppress_plan', 'numberposts' => 100, 'post_status' => 'any'));
        foreach ($posts as $p) { $plans[$p->ID] = $p->post_title; }
        if ($plans) { $via = 'post type'; }
        return $plans;
    }

    /** Discovered plans plus any IDs the admin added by hand. */
    public static function all_plans(&$via = null) {
        $plans = self::profilepress_plans($via);
        $s = self::settings();
        foreach (self::parse_ids($s['extra_plan_ids']) as $id) {
            if (!isset($plans[$id])) { $plans[$id] = 'Plan #' . $id . ' (added manually)'; }
        }
        ksort($plans);
        return $plans;
    }

    public static function parse_ids($str) {
        $out = array();
        foreach (preg_split('/[^0-9]+/', (string) $str) as $bit) {
            $n = intval($bit);
            if ($n > 0) { $out[] = $n; }
        }
        return array_values(array_unique($out));
    }

    public static function settings_page() {
        if (!current_user_can('manage_options')) { return; }
        $s = self::settings();
        $via = null;
        $plans = self::all_plans($via);
        $tiers = self::tiers();
        ?>
        <div class="wrap">
            <h1>Boko Accounts</h1>
            <p>Signs members into the Boko SEO Studio apps using their ProfilePress membership.</p>

            <?php if (!function_exists('ppress_has_active_subscription')) : ?>
                <div class="notice notice-error"><p><strong>ProfilePress membership functions were not found.</strong>
                Make sure ProfilePress (with the membership/subscription addon) is active on this site.</p></div>
            <?php endif; ?>

            <form method="post" action="options.php">
                <?php settings_fields('boko_accounts'); ?>

                <h2>Shared secret</h2>
                <p>Must exactly match <code>BOKO_ACCOUNTS_SECRET</code> in both Vercel projects.</p>
                <input type="text" class="regular-text code" name="<?php echo esc_attr(self::OPT); ?>[secret]"
                       value="<?php echo esc_attr($s['secret']); ?>" style="width:520px" />
                <p class="description">Generate one with <code>openssl rand -hex 32</code>. Treat it like a password.</p>

                <h2>Plan mapping</h2>
                <p>Tell the apps what each of your ProfilePress plans is worth.</p>
                <p><label>Extra plan IDs (comma separated) —
                    <input type="text" class="regular-text code" style="width:220px"
                           name="<?php echo esc_attr(self::OPT); ?>[extra_plan_ids]"
                           value="<?php echo esc_attr($s['extra_plan_ids']); ?>" placeholder="e.g. 9, 10" />
                </label><br /><span class="description">Only needed if a plan is missing from the list below.
                Find IDs under <strong>ProfilePress → Membership Plans</strong>. Save to add them as rows.</span></p>
                <?php if (empty($plans)) : ?>
                    <p><em>No ProfilePress plans detected automatically. Add their IDs in the box above and save.</em></p>
                <?php else : ?>
                <table class="widefat striped" style="max-width:820px">
                    <thead><tr><th>ProfilePress plan</th><th>ID</th><th>Maps to</th><th>Limits applied</th></tr></thead>
                    <tbody>
                    <?php foreach ($plans as $pid => $pname) :
                        $current = isset($s['plan_map'][$pid]) ? $s['plan_map'][$pid] : ''; ?>
                        <tr>
                            <td><strong><?php echo esc_html($pname); ?></strong></td>
                            <td><code><?php echo intval($pid); ?></code></td>
                            <td>
                                <select name="<?php echo esc_attr(self::OPT); ?>[plan_map][<?php echo intval($pid); ?>]">
                                    <option value="">— ignore —</option>
                                    <?php foreach ($tiers as $key => $t) : ?>
                                        <option value="<?php echo esc_attr($key); ?>" <?php selected($current, $key); ?>>
                                            <?php echo esc_html($t['label']); ?>
                                        </option>
                                    <?php endforeach; ?>
                                </select>
                            </td>
                            <td><?php
                                if ($current && isset($tiers[$current])) {
                                    $t = $tiers[$current];
                                    echo esc_html(sprintf(
                                        '%s store(s), %s items/month%s',
                                        $t['stores'],
                                        $t['itemsPerMonth'] ? number_format($t['itemsPerMonth']) : 'unlimited',
                                        $t['autoOptimise'] ? ', auto-optimise' : ''
                                    ));
                                } else { echo '—'; }
                            ?></td>
                        </tr>
                    <?php endforeach; ?>
                    </tbody>
                </table>
                <p class="description">A member with no mapped active plan is treated as <strong>Free</strong>.
                If someone holds more than one plan, the most generous one wins.</p>
                <?php endif; ?>

                <h2>Role mapping</h2>
                <p>Grant a plan by WordPress role — for comps, staff and test accounts, or when you
                assign a ProfilePress plan role by hand instead of taking a payment.
                A role here counts the same as a paid subscription.</p>
                <?php $all_roles = wp_roles()->get_names(); ?>
                <table class="widefat striped" style="max-width:620px">
                    <thead><tr><th>WordPress role</th><th>Slug</th><th>Maps to</th></tr></thead>
                    <tbody>
                    <?php foreach ($all_roles as $slug => $label) :
                        $cur = isset($s['role_map'][$slug]) ? $s['role_map'][$slug] : ''; ?>
                        <tr>
                            <td><strong><?php echo esc_html($label); ?></strong></td>
                            <td><code><?php echo esc_html($slug); ?></code></td>
                            <td>
                                <select name="<?php echo esc_attr(self::OPT); ?>[role_map][<?php echo esc_attr($slug); ?>]">
                                    <option value="">— ignore —</option>
                                    <?php foreach ($tiers as $key => $t) : ?>
                                        <option value="<?php echo esc_attr($key); ?>" <?php selected($cur, $key); ?>><?php echo esc_html($t['label']); ?></option>
                                    <?php endforeach; ?>
                                </select>
                            </td>
                        </tr>
                    <?php endforeach; ?>
                    </tbody>
                </table>

                <h2>Allowed app URLs</h2>
                <p>One per line. Logins will only ever redirect back to these origins.</p>
                <textarea name="<?php echo esc_attr(self::OPT); ?>[allowed_apps]" rows="4" style="width:520px" class="code"><?php
                    echo esc_textarea($s['allowed_apps']); ?></textarea>

                <?php submit_button(); ?>
            </form>

            <hr />
            <h2>Check a member</h2>
            <p>Shows exactly what plan the apps would give someone, and why — without needing
            their password. Use it to verify a test account, or when a customer says
            &ldquo;I paid but it still says Free&rdquo;. Read-only; nothing is changed.</p>
            <form method="get" action="">
                <input type="hidden" name="page" value="boko-accounts" />
                <input type="text" name="boko_check" class="regular-text"
                       value="<?php echo esc_attr(isset($_GET['boko_check']) ? wp_unslash($_GET['boko_check']) : ''); ?>"
                       placeholder="email, username or user ID" style="width:320px" />
                <button type="submit" class="button">Check</button>
            </form>
            <?php
            $q = isset($_GET['boko_check']) ? trim(sanitize_text_field(wp_unslash($_GET['boko_check']))) : '';
            if ($q !== '') {
                $u = is_numeric($q) ? get_user_by('id', intval($q)) : (get_user_by('email', $q) ?: get_user_by('login', $q));
                if (!$u) {
                    echo '<div class="notice notice-error inline"><p>No user found for <code>' . esc_html($q) . '</code>.</p></div>';
                } else {
                    $ent = self::entitlement_for($u->ID);
                    $why = array(
                        'subscription' => 'an active ProfilePress subscription (or its plan capability)',
                        'role'         => 'a mapped WordPress role',
                        'none'         => 'nothing — no mapped subscription or role',
                    );
                    $paid = $ent['plan'] !== 'free';
                    echo '<div class="notice ' . ($paid ? 'notice-success' : 'notice-warning') . ' inline"><p><strong>'
                        . esc_html($u->user_email) . '</strong> resolves to <strong>' . esc_html($ent['planLabel'])
                        . '</strong>, granted by ' . esc_html(isset($why[$ent['grantedBy']]) ? $why[$ent['grantedBy']] : $ent['grantedBy']) . '.</p></div>';

                    echo '<table class="widefat striped" style="max-width:820px"><tbody>';
                    echo '<tr><td style="width:230px">Roles held</td><td>';
                    foreach ((array) $u->roles as $r) { echo '<code>' . esc_html($r) . '</code> '; }
                    echo '</td></tr>';
                    echo '<tr><td>Plan</td><td><strong>' . esc_html($ent['planLabel']) . '</strong> (<code>' . esc_html($ent['plan']) . '</code>)</td></tr>';
                    echo '<tr><td>Stores allowed</td><td>' . intval($ent['limits']['stores']) . '</td></tr>';
                    echo '<tr><td>Items per month</td><td>' . ($ent['limits']['itemsPerMonth'] ? number_format($ent['limits']['itemsPerMonth']) : 'unlimited') . '</td></tr>';
                    echo '<tr><td>Auto-optimise</td><td>' . ($ent['limits']['autoOptimise'] ? 'yes' : 'no') . '</td></tr>';
                    echo '</tbody></table>';

                    echo '<h4>How each mapped plan evaluated</h4><table class="widefat striped" style="max-width:820px">'
                        . '<thead><tr><th>Plan</th><th>Tier</th><th>Active subscription</th><th>Has plan capability</th></tr></thead><tbody>';
                    $all = self::all_plans();
                    foreach ((array) $s['plan_map'] as $pid => $tier) {
                        $sub = function_exists('ppress_has_active_subscription') ? ppress_has_active_subscription($u->ID, intval($pid)) : null;
                        $cap = user_can($u->ID, 'ppress_plan_' . intval($pid));
                        echo '<tr><td>' . esc_html(isset($all[$pid]) ? $all[$pid] : ('Plan ' . $pid)) . ' <code>' . intval($pid) . '</code></td>'
                            . '<td>' . esc_html($tier) . '</td>'
                            . '<td>' . ($sub === null ? 'n/a' : ($sub ? '<strong style="color:#080">yes</strong>' : 'no')) . '</td>'
                            . '<td>' . ($cap ? '<strong style="color:#080">yes</strong>' : 'no') . '</td></tr>';
                    }
                    echo '</tbody></table>';

                    if (!empty($s['role_map'])) {
                        echo '<h4>How each mapped role evaluated</h4><table class="widefat striped" style="max-width:820px">'
                            . '<thead><tr><th>Role</th><th>Tier</th><th>User has it</th></tr></thead><tbody>';
                        foreach ((array) $s['role_map'] as $role => $tier) {
                            $has = in_array($role, (array) $u->roles, true);
                            echo '<tr><td><code>' . esc_html($role) . '</code></td><td>' . esc_html($tier) . '</td>'
                                . '<td>' . ($has ? '<strong style="color:#080">yes</strong>' : 'no') . '</td></tr>';
                        }
                        echo '</tbody></table>';
                    }
                }
            }
            ?>

            <hr />
            <h2>Health check</h2>
            <table class="widefat striped" style="max-width:820px"><tbody>
                <tr><td>Plugin version</td><td><code><?php echo esc_html(self::VERSION); ?></code></td></tr>
                <tr><td>ProfilePress membership</td><td><?php echo function_exists('ppress_has_active_subscription')
                    ? '<span style="color:#080">detected</span>' : '<span style="color:#c00">NOT detected</span>'; ?></td></tr>
                <tr><td>Shared secret</td><td><?php echo $s['secret']
                    ? '<span style="color:#080">set</span>' : '<span style="color:#c00">missing — logins will fail</span>'; ?></td></tr>
                <tr><td>Plans detected</td><td><?php echo count($plans); ?><?php echo $via ? ' <span class="description">(via ' . esc_html($via) . ')</span>' : ''; ?></td></tr>
                <tr><td>Roles mapped</td><td><?php echo count($s['role_map']); ?></td></tr>
                <tr><td>Plans mapped</td><td><?php echo count($s['plan_map']) ?: '<span style="color:#c00">0 — paid members will look Free</span>'; ?></td></tr>
                <tr><td>Entitlement endpoint</td><td><code><?php echo esc_url(rest_url('boko-account/v1/me')); ?></code></td></tr>
                <tr><td>Login URL</td><td><code><?php echo esc_url(home_url('/?boko_auth=1')); ?></code></td></tr>
            </tbody></table>
        </div>
        <?php
    }

    /* ------------------------------- signing -------------------------------- */

    private static function b64($s) { return rtrim(strtr(base64_encode($s), '+/', '-_'), '='); }
    private static function unb64($s) { return base64_decode(strtr($s, '-_', '+/')); }

    /** Compact signed token: base64url(payload).base64url(hmac) */
    public static function sign_payload($payload) {
        $s = self::settings();
        if (empty($s['secret'])) { return ''; }
        $body = self::b64(wp_json_encode($payload));
        $sig  = self::b64(hash_hmac('sha256', $body, $s['secret'], true));
        return $body . '.' . $sig;
    }

    public static function verify_token($token) {
        $s = self::settings();
        if (empty($s['secret']) || !$token || strpos($token, '.') === false) { return null; }
        list($body, $sig) = explode('.', $token, 2);
        $expected = self::b64(hash_hmac('sha256', $body, $s['secret'], true));
        if (!hash_equals($expected, $sig)) { return null; }
        $data = json_decode(self::unb64($body), true);
        if (!is_array($data)) { return null; }
        if (isset($data['exp']) && intval($data['exp']) < time()) { return null; }
        return $data;
    }

    /* ---------------------------- entitlement ------------------------------- */

    /** Best active tier for a user, considering every mapped plan. */
    public static function entitlement_for($user_id) {
        $s = self::settings();
        $tiers = self::tiers();
        $order = array('free' => 0, 'store-fix' => 1, 'agency' => 2);

        $best = 'free';
        $matched_plan = null;
        $granted_by = 'none';

        // 1. A real ProfilePress subscription, or the per-plan capability it grants.
        foreach ((array) $s['plan_map'] as $plan_id => $tier) {
            if (!isset($tiers[$tier])) { continue; }
            $active = false;
            if (function_exists('ppress_has_active_subscription')) {
                $active = (bool) ppress_has_active_subscription($user_id, intval($plan_id));
            }
            if (!$active) {
                $active = user_can($user_id, 'ppress_plan_' . intval($plan_id));
            }
            if ($active && $order[$tier] >= $order[$best]) {
                $best = $tier;
                $matched_plan = intval($plan_id);
                $granted_by = 'subscription';
            }
        }

        // 2. A mapped WordPress role. ProfilePress creates a role per plan, and
        //    assigning it by hand is how comps, staff and test accounts are granted
        //    without putting a fake payment through.
        $user = get_userdata($user_id);
        $roles = ($user && is_array($user->roles)) ? $user->roles : array();
        foreach ((array) $s['role_map'] as $role => $tier) {
            if (!isset($tiers[$tier])) { continue; }
            if (!in_array($role, $roles, true)) { continue; }
            if ($order[$tier] >= $order[$best]) {
                $best = $tier;
                if ($granted_by === 'none') { $granted_by = 'role'; }
            }
        }

        $t = $tiers[$best];
        return array(
            'userId'  => intval($user_id),
            'email'   => $user ? $user->user_email : '',
            'name'    => $user ? $user->display_name : '',
            'plan'    => $best,
            'planLabel' => $t['label'],
            'planId'  => $matched_plan,
            'grantedBy' => $granted_by,
            'limits'  => array(
                'stores'        => $t['stores'],
                'itemsPerMonth' => $t['itemsPerMonth'],
                'autoOptimise'  => $t['autoOptimise'],
                'reAudit'       => $t['reAudit'],
            ),
        );
    }

    /* ------------------------------ login flow ------------------------------ */

    private static function allowed_origin($url) {
        $s = self::settings();
        $allowed = array_filter(array_map('trim', preg_split('/\r\n|\r|\n/', (string) $s['allowed_apps'])));
        $target = wp_parse_url($url);
        if (empty($target['host'])) { return false; }
        foreach ($allowed as $a) {
            $p = wp_parse_url($a);
            if (!empty($p['host']) && strtolower($p['host']) === strtolower($target['host'])) { return true; }
        }
        return false;
    }

    /**
     * GET /?boko_auth=1&redirect=<app callback>&state=<opaque>
     * Not logged in  -> ProfilePress/WP login, then straight back here.
     * Logged in      -> bounce to the app with a short-lived signed token.
     */
    public static function handle_login_handoff() {
        if (!isset($_GET['boko_auth'])) { return; }

        $redirect = isset($_GET['redirect']) ? esc_url_raw(wp_unslash($_GET['redirect'])) : '';
        $state    = isset($_GET['state']) ? sanitize_text_field(wp_unslash($_GET['state'])) : '';

        if (!$redirect || !self::allowed_origin($redirect)) {
            wp_die('That app URL is not on the allow-list in Boko Accounts settings.', 'Boko Accounts', array('response' => 400));
        }

        if (!is_user_logged_in()) {
            $self = add_query_arg(
                array('boko_auth' => 1, 'redirect' => rawurlencode($redirect), 'state' => rawurlencode($state)),
                home_url('/')
            );
            wp_safe_redirect(wp_login_url($self));
            exit;
        }

        $ent = self::entitlement_for(get_current_user_id());
        $ent['iss'] = home_url('/');
        $ent['iat'] = time();
        $ent['exp'] = time() + self::TOKEN_TTL;
        $ent['state'] = $state;

        $token = self::sign_payload($ent);
        if (!$token) {
            wp_die('Boko Accounts has no shared secret set. Add it under Settings → Boko Accounts.', 'Boko Accounts', array('response' => 500));
        }

        wp_redirect(add_query_arg(array('boko_token' => rawurlencode($token), 'state' => rawurlencode($state)), $redirect));
        exit;
    }

    /* --------------------------------- REST --------------------------------- */

    public static function routes() {
        register_rest_route('boko-account/v1', '/me', array(
            'methods'  => 'GET',
            'callback' => array(__CLASS__, 'route_me'),
            'permission_callback' => '__return_true', // token-authenticated below
        ));
        register_rest_route('boko-account/v1', '/ping', array(
            'methods'  => 'GET',
            'callback' => array(__CLASS__, 'route_ping'),
            'permission_callback' => '__return_true',
        ));
    }

    public static function route_ping() {
        $s = self::settings();
        return array(
            'ok' => true,
            'version' => self::VERSION,
            'profilepress' => function_exists('ppress_has_active_subscription'),
            'secretSet' => !empty($s['secret']),
            'plansMapped' => count($s['plan_map']),
        );
    }

    /**
     * GET /wp-json/boko-account/v1/me
     * Authorization: Bearer <token from the login handoff>
     * Re-reads the membership live, so a cancelled or lapsed subscription drops
     * the member back to Free the next time an app checks.
     */
    public static function route_me($request) {
        $auth = $request->get_header('authorization');
        $token = '';
        if ($auth && preg_match('/Bearer\s+(.+)/i', $auth, $m)) { $token = trim($m[1]); }
        if (!$token) { $token = (string) $request->get_param('token'); }

        $data = self::verify_token($token);
        if (!$data || empty($data['userId'])) {
            return new WP_Error('boko_bad_token', 'Invalid or expired token. Sign in again.', array('status' => 401));
        }
        if (!get_userdata(intval($data['userId']))) {
            return new WP_Error('boko_no_user', 'That account no longer exists.', array('status' => 401));
        }

        $ent = self::entitlement_for(intval($data['userId']));
        $ent['iss'] = home_url('/');
        $ent['iat'] = time();
        $ent['exp'] = time() + self::SESSION_TTL;
        $ent['token'] = self::sign_payload($ent); // rolling token so sessions stay fresh
        return $ent;
    }
}

Boko_Accounts::init();

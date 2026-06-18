<?php
/**
 * Plugin Name: Boko SEO Bridge
 * Description: Exposes a simple, SEO-plugin-agnostic REST API for the Boko SEO Meta Studio to read and write meta titles & descriptions across posts, pages, post categories, and (if active) WooCommerce products and product categories. Compatible with Yoast SEO, Rank Math, or standalone.
 * Version: 1.0.0
 * Author: Boko Digital
 */

if (!defined('ABSPATH')) { exit; }

class Boko_SEO_Bridge {

    const LIMIT = 100;

    public static function init() {
        add_action('rest_api_init', array(__CLASS__, 'register_routes'));
        // When no known SEO plugin is active, render our own meta so imports take effect.
        if (self::detect_plugin() === 'none') {
            add_action('wp_head', array(__CLASS__, 'render_head'), 1);
            add_filter('document_title_parts', array(__CLASS__, 'filter_title'), 99);
        }
    }

    /* ---------------- REST ---------------- */

    public static function register_routes() {
        register_rest_route('boko-seo/v1', '/ping', array(
            'methods'  => 'GET',
            'callback' => array(__CLASS__, 'route_ping'),
            'permission_callback' => array(__CLASS__, 'permission'),
        ));
        register_rest_route('boko-seo/v1', '/items', array(
            'methods'  => 'GET',
            'callback' => array(__CLASS__, 'route_items'),
            'permission_callback' => array(__CLASS__, 'permission'),
        ));
        register_rest_route('boko-seo/v1', '/update', array(
            'methods'  => 'POST',
            'callback' => array(__CLASS__, 'route_update'),
            'permission_callback' => array(__CLASS__, 'permission'),
        ));
    }

    public static function permission() {
        return current_user_can('manage_options');
    }

    public static function route_ping() {
        return array(
            'ok' => true,
            'seo' => self::detect_plugin(),
            'woocommerce' => class_exists('WooCommerce'),
        );
    }

    public static function route_items() {
        $woo = class_exists('WooCommerce');
        $groups = array(
            'pages'             => self::collect_posts('page'),
            'posts'             => self::collect_posts('post'),
            'postCategories'    => self::collect_terms('category'),
            'products'          => $woo ? self::collect_posts('product') : array(),
            'productCategories' => $woo ? self::collect_terms('product_cat') : array(),
        );
        return array(
            'site' => get_bloginfo('name'),
            'seo' => self::detect_plugin(),
            'woocommerce' => $woo,
            'groups' => $groups,
        );
    }

    public static function route_update($request) {
        $type  = sanitize_text_field($request->get_param('type'));
        $id    = intval($request->get_param('id'));
        $title = (string) $request->get_param('metaTitle');
        $desc  = (string) $request->get_param('metaDesc');

        if (!$id || $title === '') {
            return new WP_Error('boko_bad_request', 'type, id and metaTitle are required.', array('status' => 400));
        }

        $is_term = in_array($type, array('postCategories', 'productCategories'), true);
        if ($is_term) {
            self::set_term_meta($id, $title, $desc);
        } else {
            self::set_post_meta($id, $title, $desc);
        }
        return array('ok' => true);
    }

    /* ---------------- Collectors ---------------- */

    private static function collect_posts($post_type) {
        $items = array();
        $posts = get_posts(array(
            'post_type'      => $post_type,
            'post_status'    => array('publish', 'draft', 'pending', 'private'),
            'numberposts'    => self::LIMIT,
            'orderby'        => 'modified',
            'order'          => 'DESC',
            'suppress_filters' => false,
        ));
        foreach ($posts as $p) {
            $meta = self::get_post_meta_pair($p->ID);
            $context = wp_strip_all_tags(($p->post_excerpt !== '' ? $p->post_excerpt : $p->post_content));
            $items[] = array(
                'id'        => $p->ID,
                'title'     => html_entity_decode(get_the_title($p->ID)),
                'slug'      => $p->post_name,
                'link'      => get_permalink($p->ID),
                'context'   => self::trim_words($context, 1200),
                'metaTitle' => $meta[0],
                'metaDesc'  => $meta[1],
            );
        }
        return $items;
    }

    private static function collect_terms($taxonomy) {
        $items = array();
        $terms = get_terms(array(
            'taxonomy'   => $taxonomy,
            'hide_empty' => false,
            'number'     => self::LIMIT,
        ));
        if (is_wp_error($terms)) { return $items; }
        foreach ($terms as $t) {
            $meta = self::get_term_meta_pair($t->term_id, $taxonomy);
            $items[] = array(
                'id'        => $t->term_id,
                'title'     => html_entity_decode($t->name),
                'slug'      => $t->slug,
                'link'      => get_term_link($t),
                'context'   => self::trim_words(wp_strip_all_tags($t->description), 600),
                'metaTitle' => $meta[0],
                'metaDesc'  => $meta[1],
            );
        }
        return $items;
    }

    private static function trim_words($s, $max) {
        $s = trim(preg_replace('/\s+/', ' ', (string) $s));
        if (strlen($s) <= $max) { return $s; }
        return substr($s, 0, $max);
    }

    /* ---------------- SEO plugin detection & key mapping ---------------- */

    public static function detect_plugin() {
        if (defined('WPSEO_VERSION')) { return 'yoast'; }
        if (class_exists('RankMath')) { return 'rankmath'; }
        return 'none';
    }

    private static function post_keys() {
        switch (self::detect_plugin()) {
            case 'yoast':    return array('_yoast_wpseo_title', '_yoast_wpseo_metadesc');
            case 'rankmath': return array('rank_math_title', 'rank_math_description');
            default:         return array('_boko_seo_title', '_boko_seo_desc');
        }
    }

    private static function term_keys() {
        switch (self::detect_plugin()) {
            case 'rankmath': return array('rank_math_title', 'rank_math_description');
            default:         return array('_boko_seo_title', '_boko_seo_desc');
            // Yoast term meta is handled separately via the wpseo_taxonomy_meta option.
        }
    }

    /* ---------------- Post meta get/set ---------------- */

    private static function get_post_meta_pair($post_id) {
        $keys = self::post_keys();
        $title = (string) get_post_meta($post_id, $keys[0], true);
        $desc  = (string) get_post_meta($post_id, $keys[1], true);
        return array($title, $desc);
    }

    private static function set_post_meta($post_id, $title, $desc) {
        $keys = self::post_keys();
        update_post_meta($post_id, $keys[0], $title);
        update_post_meta($post_id, $keys[1], $desc);
    }

    /* ---------------- Term meta get/set (incl. Yoast option) ---------------- */

    private static function get_term_meta_pair($term_id, $taxonomy) {
        if (self::detect_plugin() === 'yoast') {
            $opt = get_option('wpseo_taxonomy_meta', array());
            $row = isset($opt[$taxonomy][$term_id]) ? $opt[$taxonomy][$term_id] : array();
            return array(
                isset($row['wpseo_title']) ? (string) $row['wpseo_title'] : '',
                isset($row['wpseo_desc']) ? (string) $row['wpseo_desc'] : '',
            );
        }
        $keys = self::term_keys();
        return array(
            (string) get_term_meta($term_id, $keys[0], true),
            (string) get_term_meta($term_id, $keys[1], true),
        );
    }

    private static function set_term_meta($term_id, $title, $desc) {
        if (self::detect_plugin() === 'yoast') {
            $taxonomy = self::term_taxonomy($term_id);
            $opt = get_option('wpseo_taxonomy_meta', array());
            if (!isset($opt[$taxonomy])) { $opt[$taxonomy] = array(); }
            if (!isset($opt[$taxonomy][$term_id])) { $opt[$taxonomy][$term_id] = array(); }
            $opt[$taxonomy][$term_id]['wpseo_title'] = $title;
            $opt[$taxonomy][$term_id]['wpseo_desc']  = $desc;
            update_option('wpseo_taxonomy_meta', $opt);
            return;
        }
        $keys = self::term_keys();
        update_term_meta($term_id, $keys[0], $title);
        update_term_meta($term_id, $keys[1], $desc);
    }

    private static function term_taxonomy($term_id) {
        $term = get_term($term_id);
        return (!is_wp_error($term) && $term) ? $term->taxonomy : 'category';
    }

    /* ---------------- Front-end rendering for "none" mode ---------------- */

    public static function filter_title($parts) {
        $t = self::current_meta_title();
        if ($t) { $parts['title'] = $t; }
        return $parts;
    }

    public static function render_head() {
        $desc = self::current_meta_desc();
        if ($desc) {
            echo '<meta name="description" content="' . esc_attr($desc) . '" />' . "\n";
            echo '<meta property="og:description" content="' . esc_attr($desc) . '" />' . "\n";
        }
    }

    private static function current_meta_title() {
        if (is_singular()) {
            $v = get_post_meta(get_queried_object_id(), '_boko_seo_title', true);
            return $v ? $v : '';
        }
        if (is_category() || is_tax()) {
            $v = get_term_meta(get_queried_object_id(), '_boko_seo_title', true);
            return $v ? $v : '';
        }
        return '';
    }

    private static function current_meta_desc() {
        if (is_singular()) {
            $v = get_post_meta(get_queried_object_id(), '_boko_seo_desc', true);
            return $v ? $v : '';
        }
        if (is_category() || is_tax()) {
            $v = get_term_meta(get_queried_object_id(), '_boko_seo_desc', true);
            return $v ? $v : '';
        }
        return '';
    }
}

Boko_SEO_Bridge::init();

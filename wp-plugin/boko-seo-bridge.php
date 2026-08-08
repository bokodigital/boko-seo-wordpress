<?php
/**
 * Plugin Name: Boko SEO Bridge
 * Description: Exposes a simple, SEO-plugin-agnostic REST API for the Boko SEO Meta Studio to read and write meta titles & descriptions across posts, pages, post categories, and (if active) WooCommerce products and product categories, plus image alt text across the media library. Compatible with Yoast SEO, Rank Math, or standalone.
 * Version: 1.1.0
 * Author: Boko Digital
 */

if (!defined('ABSPATH')) { exit; }

class Boko_SEO_Bridge {

    const LIMIT = 100;
    const VERSION = '1.1.0';
    const IMAGE_LIMIT = 100;

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
        // v1.1.0 — image alt text
        register_rest_route('boko-seo/v1', '/images', array(
            'methods'  => 'GET',
            'callback' => array(__CLASS__, 'route_images'),
            'permission_callback' => array(__CLASS__, 'permission'),
        ));
        register_rest_route('boko-seo/v1', '/alt', array(
            'methods'  => 'POST',
            'callback' => array(__CLASS__, 'route_alt'),
            'permission_callback' => array(__CLASS__, 'permission'),
        ));
    }

    public static function permission() {
        return current_user_can('manage_options');
    }

    public static function route_ping() {
        return array(
            'ok' => true,
            'version' => self::VERSION,
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
            'version' => self::VERSION,
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

    /* ---------------- Images / alt text (v1.1.0) ---------------- */

    /**
     * List image attachments with no alt text.
     * GET /boko-seo/v1/images?offset=0&limit=100
     */
    public static function route_images($request) {
        $limit  = intval($request->get_param('limit'));
        $offset = intval($request->get_param('offset'));
        if ($limit <= 0 || $limit > 200) { $limit = self::IMAGE_LIMIT; }
        if ($offset < 0) { $offset = 0; }

        $q = new WP_Query(array(
            'post_type'      => 'attachment',
            'post_status'    => 'inherit',
            'post_mime_type' => array('image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/avif'),
            'posts_per_page' => $limit,
            'offset'         => $offset,
            'orderby'        => 'date',
            'order'          => 'DESC',
            'no_found_rows'  => false,
            'meta_query'     => array(
                'relation' => 'OR',
                array('key' => '_wp_attachment_image_alt', 'compare' => 'NOT EXISTS'),
                array('key' => '_wp_attachment_image_alt', 'value' => '', 'compare' => '='),
            ),
        ));

        $items = array();
        foreach ($q->posts as $att) {
            $full  = wp_get_attachment_url($att->ID);
            $thumb = wp_get_attachment_image_url($att->ID, 'medium');
            $parent_id = intval($att->post_parent);
            $parent_title = '';
            $parent_type  = '';
            $parent_link  = '';
            if ($parent_id) {
                $parent = get_post($parent_id);
                if ($parent) {
                    $parent_title = html_entity_decode(get_the_title($parent_id));
                    $obj = get_post_type_object($parent->post_type);
                    $parent_type = ($obj && isset($obj->labels->singular_name)) ? $obj->labels->singular_name : $parent->post_type;
                    $parent_link = get_permalink($parent_id);
                }
            }
            $items[] = array(
                'id'          => $att->ID,
                'url'         => $full,
                'thumb'       => $thumb ? $thumb : $full,
                'filename'    => wp_basename(get_attached_file($att->ID)),
                'title'       => html_entity_decode($att->post_title),
                'caption'     => html_entity_decode(wp_strip_all_tags($att->post_excerpt)),
                'parentId'    => $parent_id,
                'parentTitle' => $parent_title,
                'parentType'  => $parent_type,
                'parentLink'  => $parent_link,
                'index'       => self::attachment_index($att->ID, $parent_id),
                'editLink'    => get_edit_post_link($att->ID, 'raw'),
            );
        }

        return array(
            'version'  => self::VERSION,
            'images'   => $items,
            'offset'   => $offset,
            'limit'    => $limit,
            'total'    => intval($q->found_posts),
            'hasMore'  => ($offset + count($items)) < intval($q->found_posts),
        );
    }

    /**
     * Save alt text for one attachment.
     * POST /boko-seo/v1/alt  { id, alt }
     */
    public static function route_alt($request) {
        $id  = intval($request->get_param('id'));
        $alt = (string) $request->get_param('alt');
        $alt = trim(preg_replace('/\s+/', ' ', wp_strip_all_tags($alt)));

        if (!$id) {
            return new WP_Error('boko_bad_request', 'id is required.', array('status' => 400));
        }
        if ($alt === '') {
            return new WP_Error('boko_bad_request', "Alt text can't be empty.", array('status' => 400));
        }
        if (mb_strlen($alt) > 125) {
            return new WP_Error('boko_bad_request', 'Alt text must be 125 characters or fewer.', array('status' => 400));
        }
        $post = get_post($id);
        if (!$post || $post->post_type !== 'attachment') {
            return new WP_Error('boko_not_found', 'That image was not found in the media library.', array('status' => 404));
        }
        if (strpos((string) $post->post_mime_type, 'image/') !== 0) {
            return new WP_Error('boko_bad_request', 'That attachment is not an image.', array('status' => 400));
        }

        update_post_meta($id, '_wp_attachment_image_alt', sanitize_text_field($alt));
        return array('ok' => true, 'id' => $id, 'alt' => $alt);
    }

    /**
     * Where this image sits among its parent's images: 0 for the featured
     * image, 1..n for WooCommerce gallery images. Drives the "alternate view"
     * wording in generated alt text.
     */
    private static function attachment_index($att_id, $parent_id) {
        if (!$parent_id) { return 0; }
        if (intval(get_post_thumbnail_id($parent_id)) === intval($att_id)) { return 0; }
        $gallery = get_post_meta($parent_id, '_product_image_gallery', true);
        if ($gallery) {
            $ids = array_map('intval', array_filter(explode(',', (string) $gallery)));
            $pos = array_search(intval($att_id), $ids, true);
            if ($pos !== false) { return $pos + 1; }
        }
        return 0;
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

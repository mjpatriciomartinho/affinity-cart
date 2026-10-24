<?php
namespace AffinityCart;

defined( 'ABSPATH' ) || exit;

/**
 * REST routes under /wp-json/affinity-cart/v1. Admin routes proxy to the
 * service so the store key never reaches the browser; storefront routes add
 * the visitor's coarse location before asking for recommendations.
 */
class Rest {
	const NS = 'affinity-cart/v1';

	public static function init(): void {
		add_action( 'rest_api_init', array( __CLASS__, 'routes' ) );
	}

	public static function routes(): void {
		$admin = static fn() => current_user_can( 'manage_woocommerce' );

		register_rest_route( self::NS, '/state', array( 'methods' => 'GET', 'callback' => array( __CLASS__, 'state' ), 'permission_callback' => $admin ) );
		register_rest_route( self::NS, '/settings', array( 'methods' => 'POST', 'callback' => array( __CLASS__, 'settings' ), 'permission_callback' => $admin ) );
		register_rest_route( self::NS, '/run', array( 'methods' => 'POST', 'callback' => static fn() => self::out( Autopilot::run( 'manual' ) ), 'permission_callback' => $admin ) );
		register_rest_route( self::NS, '/kits/(?P<id>[\w-]+)/publish', array( 'methods' => 'POST', 'callback' => array( __CLASS__, 'publish_kit' ), 'permission_callback' => $admin ) );
		register_rest_route( self::NS, '/ghost/(?P<i>\d+)/draft', array( 'methods' => 'POST', 'callback' => array( __CLASS__, 'ghost_draft' ), 'permission_callback' => $admin ) );
		register_rest_route( self::NS, '/tribes/(?P<id>[\w-]+)/export', array( 'methods' => 'POST', 'callback' => array( __CLASS__, 'export_tribe' ), 'permission_callback' => $admin ) );
		register_rest_route( self::NS, '/sync', array( 'methods' => 'POST', 'callback' => array( __CLASS__, 'sync' ), 'permission_callback' => $admin ) );
		register_rest_route(
			self::NS,
			'/steps/(?P<step>dna|tribes|ghost|recs)',
			array(
				'methods'             => 'POST',
				'callback'            => static fn( \WP_REST_Request $r ) => self::out( Client::request( 'POST', '/steps/' . $r['step'] . '/run', array() ) ),
				'permission_callback' => $admin,
			)
		);
		register_rest_route( self::NS, '/apply', array( 'methods' => 'POST', 'callback' => array( __CLASS__, 'apply' ), 'permission_callback' => $admin ) );

		register_rest_route(
			self::NS,
			'/recs/(?P<id>\d+)',
			array(
				'methods'             => 'GET',
				'callback'            => array( __CLASS__, 'recs' ),
				'permission_callback' => '__return_true',
			)
		);
		register_rest_route( self::NS, '/live', array( 'methods' => 'POST', 'callback' => array( __CLASS__, 'live' ), 'permission_callback' => '__return_true' ) );
		register_rest_route( self::NS, '/gift', array( 'methods' => 'POST', 'callback' => array( __CLASS__, 'gift' ), 'permission_callback' => '__return_true' ) );
		register_rest_route( self::NS, '/cart', array( 'methods' => 'POST', 'callback' => array( __CLASS__, 'cart' ), 'permission_callback' => '__return_true' ) );
	}

	private static function out( $res ) {
		return is_wp_error( $res ) ? $res : rest_ensure_response( $res );
	}

	public static function sync() {
		$snapshot = Sync::snapshot();
		$res      = Client::request( 'POST', '/sync', $snapshot, 60 );
		if ( is_wp_error( $res ) ) {
			return $res;
		}
		// Show the merchant exactly what was read and what left the store.
		$res['read'] = array(
			'products'  => count( $snapshot['products'] ),
			'customers' => count( $snapshot['customers'] ),
			'orders'    => count( $snapshot['orders'] ),
			'sample'    => array(
				'customer' => $snapshot['customers'][0] ?? null,
				'order'    => $snapshot['orders'][0] ?? null,
			),
		);
		return rest_ensure_response( $res );
	}

	/** Service state plus what lives only in WordPress: settings, activity log, published kits, drafts. */
	public static function state() {
		$state = Client::request( 'GET', '/state' );
		if ( is_wp_error( $state ) ) {
			return $state;
		}
		Autopilot::maybe_apply( $state );
		$state['local'] = array(
			'autopilot'  => Autopilot::enabled(),
			'giftFinder' => Storefront::gift_finder_enabled(),
			'log'        => (array) get_option( 'affinity_cart_log', array() ),
			'appliedAt'  => (int) get_option( 'affinity_cart_applied_at', 0 ),
			'kits'       => array_map(
				static fn( $k ) => array( 'postId' => $k['postId'], 'url' => get_permalink( $k['postId'] ) ),
				(array) get_option( 'affinity_cart_kits', array() )
			),
			'drafts'     => array_map(
				static fn( $id ) => array( 'postId' => $id, 'editUrl' => get_edit_post_link( $id, 'raw' ) ),
				(array) get_option( 'affinity_cart_drafts', array() )
			),
		);
		return rest_ensure_response( $state );
	}

	public static function settings( \WP_REST_Request $r ) {
		foreach ( array( 'autopilot' => 'affinity_cart_autopilot', 'giftFinder' => 'affinity_cart_gift_finder' ) as $param => $option ) {
			if ( null !== $r->get_param( $param ) ) {
				$on = rest_sanitize_boolean( $r->get_param( $param ) );
				update_option( $option, $on ? 'yes' : 'no' );
				Autopilot::log( sprintf( '%s turned %s.', 'autopilot' === $param ? 'Autopilot' : 'Gift finder', $on ? 'on' : 'off' ) );
			}
		}
		return rest_ensure_response( array( 'autopilot' => Autopilot::enabled(), 'giftFinder' => Storefront::gift_finder_enabled() ) );
	}

	private static function find( string $list, callable $match ) {
		$state = Client::request( 'GET', '/state' );
		if ( is_wp_error( $state ) ) {
			return $state;
		}
		foreach ( (array) ( $state[ $list ] ?? array() ) as $i => $item ) {
			if ( $match( $item, $i ) ) {
				return $item;
			}
		}
		return new \WP_Error( 'affinity_cart_not_found', 'Not found', array( 'status' => 404 ) );
	}

	public static function publish_kit( \WP_REST_Request $r ) {
		$kit = self::find( 'kits', static fn( $k ) => $k['id'] === $r['id'] );
		if ( is_wp_error( $kit ) ) {
			return $kit;
		}
		$id = Actions::publish_kit( $kit );
		Autopilot::log( sprintf( 'Published the kit "%s".', $kit['name'] ) );
		return rest_ensure_response( array( 'postId' => $id, 'url' => get_permalink( $id ) ) );
	}

	public static function ghost_draft( \WP_REST_Request $r ) {
		$ghost = self::find( 'ghost', static fn( $g, $i ) => (int) $i === (int) $r['i'] );
		if ( is_wp_error( $ghost ) ) {
			return $ghost;
		}
		$id = Actions::draft_from_ghost( $ghost );
		Autopilot::log( sprintf( 'Created a draft product for "%s".', $ghost['title'] ) );
		return rest_ensure_response( array( 'postId' => $id, 'editUrl' => get_edit_post_link( $id, 'raw' ) ) );
	}

	public static function export_tribe( \WP_REST_Request $r ) {
		$tribe = self::find( 'tribes', static fn( $t ) => $t['id'] === $r['id'] );
		if ( is_wp_error( $tribe ) ) {
			return $tribe;
		}
		$res = Actions::export_tribe( $tribe );
		Autopilot::log( sprintf( 'Exported %d customers of "%s" for a campaign.', $res['count'], $tribe['name'] ) );
		return rest_ensure_response( $res );
	}

	/** Writes the recommendations into WooCommerce: cross-sells, plus kits as products. */
	public static function apply() {
		$state = Client::request( 'GET', '/state' );
		if ( is_wp_error( $state ) ) {
			return $state;
		}
		$res = Actions::apply( $state );
		Autopilot::log( sprintf( 'Updated cross-sells on %d products and published %d kits.', $res['updated'], $res['kits'] ) );
		return rest_ensure_response( $res );
	}

	public static function recs( \WP_REST_Request $r ) {
		$id = (int) $r['id'];
		// Keyed by the last time cross-sells were applied, so new results show up at once.
		$key    = 'affinity_cart_recs_' . $id . '_' . (int) get_option( 'affinity_cart_applied_at', 0 );
		$cached = get_transient( $key );
		if ( false !== $cached ) {
			return rest_ensure_response( $cached );
		}
		$res = Client::request( 'GET', "/recs/$id", null, 10 );
		if ( is_wp_error( $res ) ) {
			return rest_ensure_response( array( 'recs' => array(), 'kits' => array() ) );
		}
		set_transient( $key, $res, 10 * MINUTE_IN_SECONDS );
		return rest_ensure_response( $res );
	}

	/** Adds products to the shopper's cart, tagged with the Affinity Cart block they came from. */
	public static function cart( \WP_REST_Request $r ) {
		$source = sanitize_key( (string) $r->get_param( 'source' ) );
		if ( ! in_array( $source, Storefront::SOURCES, true ) ) {
			return new \WP_Error( 'affinity_cart_source', 'Unknown source', array( 'status' => 400 ) );
		}
		wc_load_cart();
		$added = array();
		foreach ( array_slice( (array) $r->get_param( 'items' ), 0, 5 ) as $id ) {
			$product = wc_get_product( (int) $id );
			if ( $product && $product->is_purchasable() && $product->is_in_stock() ) {
				$key = WC()->cart->add_to_cart( $product->get_id(), 1, 0, array(), array( 'affinity_source' => $source ) );
				if ( $key ) {
					$added[] = $product->get_id();
				}
			}
		}
		WC()->session->set_customer_session_cookie( true );
		return rest_ensure_response( array( 'added' => $added, 'count' => WC()->cart->get_cart_contents_count() ) );
	}

	public static function gift( \WP_REST_Request $r ) {
		$tastes = array_slice( array_filter( array_map( 'sanitize_text_field', (array) $r->get_param( 'tastes' ) ) ), 0, 5 );
		$budget = $r->get_param( 'budget' ) ? (float) $r->get_param( 'budget' ) : null;
		// Rate limits are per shopper; send a salted hash, never the IP itself.
		$ip      = isset( $_SERVER['REMOTE_ADDR'] ) ? sanitize_text_field( wp_unslash( $_SERVER['REMOTE_ADDR'] ) ) : '';
		$shopper = substr( hash_hmac( 'sha256', $ip, (string) get_option( 'affinity_cart_salt', 'affinity' ) ), 0, 16 );
		$res     = Client::request( 'POST', '/gift', array( 'tastes' => array_values( $tastes ), 'budget' => $budget, 'city' => Geo::visitor()['city'] ), 90, array( 'X-Shopper-Id' => $shopper ) );
		return self::out( $res );
	}

	public static function live( \WP_REST_Request $r ) {
		$viewed = array_values( array_filter( array_map( 'strval', (array) $r->get_param( 'viewed' ) ), 'ctype_digit' ) );
		$geo    = Geo::visitor();
		$res    = Client::request(
			'POST',
			'/live',
			array(
				'visitor' => array(
					'id'      => Geo::visitor_id(),
					'city'    => $geo['city'],
					'country' => $geo['country'],
					'viewed'  => array_slice( $viewed, -5 ),
				),
			),
			15
		);
		if ( is_wp_error( $res ) ) {
			return rest_ensure_response( array( 'recs' => array() ) );
		}
		return rest_ensure_response(
			array(
				'recs'    => $res['recs'] ?? array(),
				'pending' => ! empty( $res['pending'] ),
				'city'    => $geo['city'],
				'source'  => $geo['source'],
			)
		);
	}
}

/** Coarse visitor location. City level only, never stored with an identity. */
class Geo {
	public static function visitor(): array {
		$h = static fn( string $k ) => isset( $_SERVER[ $k ] ) ? sanitize_text_field( wp_unslash( $_SERVER[ $k ] ) ) : '';
		// CDN geo headers in production: CloudFront, then Cloudflare.
		if ( $h( 'HTTP_CLOUDFRONT_VIEWER_CITY' ) ) {
			return array( 'city' => $h( 'HTTP_CLOUDFRONT_VIEWER_CITY' ), 'country' => $h( 'HTTP_CLOUDFRONT_VIEWER_COUNTRY' ), 'source' => 'cdn' );
		}
		if ( $h( 'HTTP_CF_IPCITY' ) ) {
			return array( 'city' => $h( 'HTTP_CF_IPCITY' ), 'country' => $h( 'HTTP_CF_IPCOUNTRY' ), 'source' => 'cdn' );
		}
		// Demo mode: the merchant can preview the shop "as a visitor from" a city.
		if ( ! empty( $_COOKIE['affinity_city'] ) ) {
			return array( 'city' => sanitize_text_field( wp_unslash( $_COOKIE['affinity_city'] ) ), 'country' => '', 'source' => 'preview' );
		}
		return array( 'city' => get_option( 'woocommerce_store_city', '' ), 'country' => WC()->countries->get_base_country(), 'source' => 'store' );
	}

	public static function visitor_id(): string {
		if ( ! empty( $_COOKIE['affinity_vid'] ) ) {
			return sanitize_key( $_COOKIE['affinity_vid'] );
		}
		return 'anon';
	}
}

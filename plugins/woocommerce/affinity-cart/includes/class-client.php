<?php
namespace AffinityCart;

defined( 'ABSPATH' ) || exit;

/** Talks to the Affinity Cart service. The store key stays server-side. */
class Client {
	public static function api_url(): string {
		$url = defined( 'AFFINITY_CART_API_URL' ) ? AFFINITY_CART_API_URL : get_option( 'affinity_cart_api_url', 'http://127.0.0.1:8787/v1' );
		return untrailingslashit( $url );
	}

	public static function key(): string {
		// A fixed key (wp-config) connects several sites to one store, e.g. the public demo.
		if ( defined( 'AFFINITY_CART_KEY' ) ) {
			return AFFINITY_CART_KEY;
		}
		$key = get_option( 'affinity_cart_key' );
		if ( ! $key ) {
			$key = 'ac_' . wp_generate_password( 32, false );
			update_option( 'affinity_cart_key', $key );
		}
		return $key;
	}

	/**
	 * @return array|\WP_Error Decoded JSON body.
	 */
	public static function request( string $method, string $path, $body = null, int $timeout = 30, array $headers = array() ) {
		$args = array(
			'method'  => $method,
			'timeout' => $timeout,
			'headers' => array_merge(
				array(
					'X-Affinity-Key' => self::key(),
					'Content-Type'   => 'application/json',
				),
				$headers
			),
		);
		if ( null !== $body ) {
			$args['body'] = wp_json_encode( $body );
		}
		$res = wp_remote_request( self::api_url() . $path, $args );
		if ( is_wp_error( $res ) ) {
			return $res;
		}
		$code = wp_remote_retrieve_response_code( $res );
		$data = json_decode( wp_remote_retrieve_body( $res ), true );
		if ( $code >= 400 ) {
			return new \WP_Error( 'affinity_cart_api', $data['error'] ?? "Affinity Cart service returned $code", array( 'status' => $code ) );
		}
		return is_array( $data ) ? $data : array();
	}
}

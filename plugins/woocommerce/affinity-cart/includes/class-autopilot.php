<?php
namespace AffinityCart;

defined( 'ABSPATH' ) || exit;

/**
 * Autopilot keeps the store's recommendations current without the merchant:
 * new orders (and an hourly check) re-sync the store and re-run the pipeline,
 * and fresh results are written into WooCommerce as soon as they're ready.
 * Everything it does lands in the activity log shown in wp-admin.
 */
class Autopilot {
	const CRON = 'affinity_cart_autopilot';

	public static function init(): void {
		add_action( self::CRON, array( __CLASS__, 'run' ) );
		add_action( 'init', array( __CLASS__, 'schedule' ) );
		add_action( 'woocommerce_order_status_processing', array( __CLASS__, 'on_order' ), 20 );
		add_action( 'woocommerce_order_status_completed', array( __CLASS__, 'on_order' ), 20 );
	}

	public static function enabled(): bool {
		return 'no' !== get_option( 'affinity_cart_autopilot', 'yes' );
	}

	public static function schedule(): void {
		if ( self::enabled() && ! wp_next_scheduled( self::CRON ) ) {
			wp_schedule_event( time() + HOUR_IN_SECONDS, 'hourly', self::CRON );
		}
	}

	/** A new order changes what customers buy together: refresh soon, once. */
	public static function on_order(): void {
		if ( self::enabled() && ! wp_next_scheduled( self::CRON, array( 'order' ) ) ) {
			wp_schedule_single_event( time() + 2 * MINUTE_IN_SECONDS, self::CRON, array( 'order' ) );
		}
	}

	/**
	 * Sync, then run every step. Results are applied when they come back (see maybe_apply).
	 *
	 * @param string $why 'manual', 'order' or empty for the hourly check.
	 */
	public static function run( $why = '' ): array {
		$manual = 'manual' === $why;
		$sync = Client::request( 'POST', '/sync', Sync::snapshot(), 60 );
		if ( is_wp_error( $sync ) ) {
			self::log( 'Couldn\'t reach Affinity Cart: ' . $sync->get_error_message() );
			return array( 'error' => $sync->get_error_message() );
		}
		$run = Client::request( 'POST', '/pipeline/run', array() );
		if ( is_wp_error( $run ) ) {
			return array( 'error' => $run->get_error_message() );
		}
		update_option( 'affinity_cart_autopilot_pending', time(), false );
		self::log(
			$manual ? 'Refresh started by you: reading the store and re-running every step.'
				: ( 'order' === $why ? 'Autopilot started a refresh after a new order.' : 'Autopilot ran its hourly refresh.' )
		);
		return $run;
	}

	/** Called whenever the plugin fetches state: applies results it hasn't applied yet. */
	public static function maybe_apply( array $state ): void {
		$finished = strtotime( $state['steps']['recs']['finishedAt'] ?? '' ) ?: 0;
		$done     = ( $state['steps']['recs']['status'] ?? '' ) === 'done';
		if ( ! $done || $finished <= (int) get_option( 'affinity_cart_applied_at', 0 ) ) {
			return;
		}
		if ( self::enabled() || get_option( 'affinity_cart_autopilot_pending' ) ) {
			$res = Actions::apply( $state );
			delete_option( 'affinity_cart_autopilot_pending' );
			self::log( sprintf( 'Updated cross-sells on %d products and published %d kits.', $res['updated'], $res['kits'] ) );
		}
	}

	public static function log( string $text ): void {
		$log = (array) get_option( 'affinity_cart_log', array() );
		array_unshift( $log, array( 'at' => gmdate( 'c' ), 'text' => $text ) );
		update_option( 'affinity_cart_log', array_slice( $log, 0, 40 ), false );
	}
}
